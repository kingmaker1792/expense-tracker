import { SlicePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { CakeOrder, ClientHistory, FirebaseDataService, OrderPayment, OrderStatus } from '../../firebase-data.service';

type OrderFilter = 'all' | OrderStatus | 'delivered-paid' | 'delivered-unpaid';
type OrderPeriod = 'current' | 'last1' | 'last3' | 'last6' | 'next1' | 'next3' | 'active' | 'custom' | 'all';
type OrderColorFilter = 'all' | 'today' | 'future' | 'past-due' | 'past-closed';
type ContactPickerNavigator = Navigator & { contacts?: { select(fields: string[], options: { multiple: boolean }): Promise<Array<{ name?: string[]; tel?: string[] }>> } };

@Component({ selector: 'app-orders', imports: [ReactiveFormsModule, SlicePipe], templateUrl: './orders.html' })
export class Orders {
  private readonly fb = inject(FormBuilder); readonly data = inject(FirebaseDataService);
  private readonly route = inject(ActivatedRoute);
  private modalReturnFocus:HTMLElement|null = null;
  readonly weights = Array.from({ length: 60 }, (_, index) => `${(index + 1) / 2} lb`);
  readonly showForm = signal(false); readonly deliveryModal = signal(false); readonly editingId = signal<string|null>(null); readonly deleteTarget = signal<CakeOrder|null>(null); readonly paymentTarget = signal<CakeOrder|null>(null); readonly deliveryExpenseTarget = signal<CakeOrder|null>(null);
  readonly highlightedOrder = signal<string|null>(null);
  readonly filter = signal<OrderFilter>('all'); readonly period = signal<OrderPeriod>('current'); readonly selectedMonth = signal(''); readonly toast = signal('');
  readonly locationFilter=signal<'all'|'Inside complex'|'Outside complex'>('all'); readonly referralFilter=signal<'all'|'yes'|'no'>('all'); readonly metricFilter=signal<'all'|'value'|'collected'|'due'>('all'); readonly colorFilter=signal<OrderColorFilter>('all');
  readonly hasFilters=computed(()=>this.period()!=='current'||!!this.selectedMonth()||this.filter()!=='all'||!!this.orderSearch().trim()||this.locationFilter()!=='all'||this.referralFilter()!=='all'||this.metricFilter()!=='all'||this.colorFilter()!=='all');
  readonly customStart = signal(''); readonly customEnd = signal(''); readonly orderSearch = signal('');
  readonly clientMode = signal<'existing'|'new'>('existing'); readonly clientSearch = signal(''); readonly clientPickerOpen = signal(false);
  readonly contactPickerSupported=typeof navigator!=='undefined' && !!(navigator as ContactPickerNavigator).contacts?.select;
  constructor() { this.route.queryParamMap.subscribe(params => { const view=params.get('view'); if(view==='active') this.setPeriod('active'); else if(view==='all') this.setPeriod('all'); const location=params.get('location'); if(location==='Inside complex'||location==='Outside complex')this.locationFilter.set(location); if(params.get('referral')==='yes')this.referralFilter.set('yes'); }); }
  readonly clientMatches = computed(() => { const q=this.clientSearch().trim().toLocaleLowerCase(); return this.data.clients().filter(client=>!q||`${client.name} ${client.phone}`.toLocaleLowerCase().includes(q)).slice(0,8); });
  readonly filtered = computed(() => {
    const exactMonth=this.selectedMonth(); const period=this.period(); const range=period==='all'||period==='active'||period==='custom'?null:this.periodRange(period); const q=this.orderSearch().trim().toLocaleLowerCase();
    return this.data.orders().filter(o => { if(exactMonth) return o.dueDate.startsWith(exactMonth); if(period==='active') return o.status!=='Closed'; if(period==='custom') return (!this.customStart()||o.dueDate>=this.customStart())&&(!this.customEnd()||o.dueDate<=this.customEnd()); if(!range) return true; const date = new Date(`${o.dueDate}T00:00:00`); return date >= range.start && date <= range.end; })
      .filter(o => !q || `${o.customer} ${o.phone} ${o.cakeType} ${o.flavour} ${o.occasion} ${o.cakeMessage}`.toLocaleLowerCase().includes(q))
      .filter(o=>this.locationFilter()==='all'||o.location===this.locationFilter())
      .filter(o=>this.referralFilter()==='all'||o.residentReferral===(this.referralFilter()==='yes'))
      .filter(o=>this.metricFilter()==='all'||this.metricFilter()==='value'||this.metricFilter()==='collected'&&o.advancePaid>0||this.metricFilter()==='due'&&this.balance(o)>0)
      .filter(o=>{const color=this.colorFilter();if(color==='all')return true;const tone=this.orderTone(o);return color==='future'?tone==='soon'||tone==='future':color==='past-closed'?tone==='past-closed'&&o.dueDate<this.today():tone===color;})
      .filter(o => { const filter=this.filter(); if(filter==='all') return true; if(filter==='delivered-paid') return (o.status==='Delivered'||o.status==='Closed')&&this.balance(o)===0; if(filter==='delivered-unpaid') return o.status==='Delivered'&&this.balance(o)>0; return o.status===filter; }).sort((a,b) => {const today=this.today();const af=a.dueDate>=today,bf=b.dueDate>=today;return af&&bf?a.dueDate.localeCompare(b.dueDate):af?-1:bf?1:b.dueDate.localeCompare(a.dueDate);});
  });
  readonly filteredStats = computed(() => {
    const orders = this.filtered();
    return {
      openCount: orders.filter(order => order.status !== 'Closed').length,
      value: orders.reduce((sum, order) => sum + this.total(order), 0),
      collected: orders.reduce((sum, order) => sum + order.advancePaid, 0),
      due: orders.reduce((sum, order) => sum + this.balance(order), 0),
    };
  });
  readonly monthOptions = computed(() => [...new Set(this.data.orders().map(order=>order.dueDate.slice(0,7)).filter(key=>/^\d{4}-\d{2}$/.test(key)))].sort((a,b)=>b.localeCompare(a)).map(value=>({value,label:new Intl.DateTimeFormat('en-IN',{month:'long',year:'numeric'}).format(new Date(`${value}-01T00:00:00`))})));
  readonly rangeLabel = computed(() => { const exact=this.selectedMonth(); if(exact) return new Intl.DateTimeFormat('en-IN',{month:'long',year:'numeric'}).format(new Date(`${exact}-01T00:00:00`)); const period=this.period(); if(period==='active') return 'All active orders · Any date'; if(period==='all') return 'All order dates'; if(period==='custom') return this.customStart()||this.customEnd()?`${this.customStart()||'Beginning'} – ${this.customEnd()||'Today'}`:'Choose custom dates'; const {start,end}=this.periodRange(period); const fmt=new Intl.DateTimeFormat('en-IN',{day:'numeric',month:'short',year:'numeric'}); return `${fmt.format(start)} – ${fmt.format(end)}`; });
  readonly form = this.fb.nonNullable.group({
    customer: ['', Validators.required], phone: ['', [Validators.required, Validators.minLength(6), Validators.maxLength(20)]], address: [''], occasion: ['', Validators.required],
    flavour: ['', Validators.required], cakeType: ['', Validators.required], setup: ['Self pickup' as CakeOrder['setup'], Validators.required], deliveredBy: [''], deliveryMethod: ['Cab' as CakeOrder['deliveryMethod'], Validators.required], deliveryFeeType: ['Paid' as CakeOrder['deliveryFeeType'], Validators.required], deliveryBookedBy: ['Client' as CakeOrder['deliveryBookedBy'], Validators.required], deliveryCost: [0, Validators.min(0)],
    quantity: [1, [Validators.required, Validators.min(1)]], cakeWeight: [''], cakeMessage: [''],
    amount: [null as number | null, [Validators.required, Validators.min(1)]], advancePaid: [0, Validators.min(0)], paymentDate: [this.today(), Validators.required], deliveryAmount: [0, Validators.min(0)], extraExpenses: [0, Validators.min(0)], deliveryExpense: [null as number | null, Validators.min(0)],
    dueDate: [this.today(), Validators.required], status: ['Confirmed' as OrderStatus, Validators.required],
    location: ['Outside complex' as CakeOrder['location'], Validators.required], residentReferral: [false],
  });
  readonly paymentForm = this.fb.nonNullable.group({ amount: [0, [Validators.required, Validators.min(0.01)]], date: [this.today(), Validators.required], type: ['Delivery' as OrderPayment['type'], Validators.required] });
  readonly deliveryExpenseForm = this.fb.group({ amount: [null as number | null, [Validators.required, Validators.min(0)]] });

  async save(): Promise<void> {
    const v=this.form.getRawValue();
    this.refreshRequiredFields();
    const pieceProduct=this.isPieceProduct(v.cakeType);
    const deliveryNeedsCost=v.setup==='Delivery'&&v.deliveryFeeType==='Paid'&&(v.deliveryMethod==='Delivery man'||v.deliveryBookedBy==='Us');
    if (this.form.invalid || (v.cakeType!=='Hamper' && !pieceProduct && !v.cakeWeight) || (v.setup !== 'Self pickup' && !v.address.trim()) || (v.setup === 'Delivery' && (!v.deliveredBy.trim() || (deliveryNeedsCost && Number(v.deliveryCost)<=0)))) { this.form.markAllAsTouched(); this.scrollToFirstInvalid(); this.notify('Please complete the highlighted fields.', true); return; }
    const trackedDeliveryCost=v.setup==='Delivery'&&v.deliveryFeeType==='Paid'?Number(v.deliveryCost):0; const includedDeliveryAmount=v.setup==='Delivery'&&v.deliveryFeeType==='Paid'&&(v.deliveryMethod==='Delivery man'||v.deliveryBookedBy==='Us')?trackedDeliveryCost:0; const total=Number(v.amount)+includedDeliveryAmount; const paid=Number(v.advancePaid); if(paid>total){this.notify('Paid amount cannot exceed the order total.',true);return;} const status:OrderStatus = (v.status === 'Delivered' || v.status === 'Closed') ? (paid >= total ? 'Closed' : 'Delivered') : v.status;
    const id=this.editingId(); const previous=id?this.data.orders().find(order=>order.id===id):undefined; const payments:OrderPayment[]=[...(previous?.payments??[])]; const change=paid-(previous?.advancePaid??0); if(change!==0)payments.push({id:crypto.randomUUID(),amount:change,date:v.paymentDate,type:previous?'Correction':'Advance'}); const {paymentDate:_,...orderValues}=v; const actualDeliveryExpense=v.setup==='Delivery'&&v.deliveryMethod==='Delivery man'&&status!=='Confirmed'&&status!=='In progress'&&status!=='Ready' ? includedDeliveryAmount : this.needsDeliveryExpense(v.setup,v.deliveryMethod)?Number(v.deliveryExpense??0):0; const record={ ...orderValues, id:id??'', phone:v.phone.trim(), amount:Number(v.amount), advancePaid:paid, payments, deliveryAmount:includedDeliveryAmount, deliveryCost:trackedDeliveryCost, deliveryMethod:v.setup==='Delivery'?v.deliveryMethod:'Delivery man', deliveryFeeType:v.setup==='Delivery'?v.deliveryFeeType:'Free', deliveryBookedBy:v.setup==='Delivery'&&v.deliveryMethod!=='Delivery man'&&v.deliveryFeeType==='Paid'?v.deliveryBookedBy:v.deliveryMethod==='Delivery man'&&v.deliveryFeeType==='Paid'?'Us':'Client', deliveredBy:v.setup==='Delivery'?v.deliveredBy:'', extraExpenses:Number(v.extraExpenses), deliveryExpense:actualDeliveryExpense, flavour:v.cakeType==='Hamper'?'':v.flavour, cakeMessage:v.cakeType==='Hamper'?'':v.cakeMessage, quantity:pieceProduct?Number(v.quantity):1, cakeWeight:pieceProduct||v.cakeType==='Hamper'?'':v.cakeWeight, status } as CakeOrder;
    try { if(id) await this.data.updateOrder(record); else { const {id:_,...newOrder}=record; await this.data.addOrder(newOrder); } this.notify(id ? 'Order updated successfully.' : 'Cake order added successfully.'); this.closeForm(); } catch { this.notify('Unable to save order. Check Firebase access.', true); }
  }
  openNewOrder():void { this.modalReturnFocus=document.activeElement as HTMLElement; this.closeForm(); this.clientMode.set(this.data.clients().length?'existing':'new'); this.showForm.set(true); this.focusOrderDialog(); }
  edit(order:CakeOrder):void { this.modalReturnFocus=document.activeElement as HTMLElement; this.editingId.set(order.id); this.resetOrderForm(); this.showForm.set(true); this.focusOrderDialog(); }
  resetOrderForm():void {
    const order=this.data.orders().find(item=>item.id===this.editingId());
    this.form.reset(order?{...order,deliveryExpense:order.deliveryExpense??((order.status==='Delivered'||order.status==='Closed')&&order.setup==='Delivery'&&order.deliveryBookedBy==='Us'?order.deliveryCost:0),paymentDate:this.today()}:this.defaults());
    this.onProductTypeChangeValue(order?.cakeType??'');
    this.refreshRequiredFields();
    this.clientMode.set(order?'new':this.data.clients().length?'existing':'new');
    this.clientSearch.set('');this.clientPickerOpen.set(false);
    document.querySelector<HTMLElement>('.order-editor-form')?.scrollTo({top:0,behavior:'smooth'});
  }
  private focusOrderDialog():void { requestAnimationFrame(()=>document.querySelector<HTMLElement>('.order-editor-close')?.focus({preventScroll:true})); }
  onOrderDialogKeydown(event:KeyboardEvent):void {
    if(event.key==='Escape'&&!this.deliveryModal()){event.preventDefault();this.closeForm();return;}
    if(event.key!=='Tab')return;
    const controls=[...document.querySelectorAll<HTMLElement>('.order-editor-dialog button, .order-editor-dialog input, .order-editor-dialog select, .order-editor-dialog textarea')].filter(item=>!item.hasAttribute('disabled')&&item.getClientRects().length>0);
    if(!controls.length)return;
    const first=controls[0],last=controls.at(-1);
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
  }
  requestRemove(order:CakeOrder):void { this.deleteTarget.set(order); }
  async confirmRemove():Promise<void> {
    const order=this.deleteTarget(); if(!order) return;
    this.deleteTarget.set(null);
    try { await this.data.deleteOrder(order.id); this.notify(`${order.customer}'s order deleted.`); }
    catch { this.notify('Unable to delete order.', true); }
  }
  closeForm():void { const wasOpen=this.showForm(); this.showForm.set(false); this.editingId.set(null); this.clientSearch.set(''); this.clientPickerOpen.set(false); this.form.reset(this.defaults()); this.refreshRequiredFields(); if(wasOpen){const returnFocus=this.modalReturnFocus;this.modalReturnFocus=null;requestAnimationFrame(()=>{if(returnFocus?.isConnected)returnFocus.focus({preventScroll:true});});} }
  updateClientSearch(event:Event):void { this.clientSearch.set((event.target as HTMLInputElement).value); this.form.patchValue({customer:'',phone:'',address:''}); this.clientPickerOpen.set(true); }
  selectClient(client:ClientHistory):void { this.form.patchValue({customer:client.name,phone:client.phone,address:client.address,location:client.location,residentReferral:client.residentReferral}); this.clientSearch.set(`${client.name} · ${client.phone}`); this.clientPickerOpen.set(false); }
  useNewClient():void { const name=this.form.controls.customer.value?'':this.clientSearch().trim(); this.clientMode.set('new'); this.clientPickerOpen.set(false); this.form.patchValue({customer:name,phone:'',address:''}); }
  useExistingClient():void { this.clientMode.set('existing'); this.clientSearch.set(''); this.clientPickerOpen.set(false); this.form.patchValue({customer:'',phone:'',address:''}); }
  async pickContact():Promise<void> { try { const contacts=await (navigator as ContactPickerNavigator).contacts?.select(['name','tel'],{multiple:false}); const contact=contacts?.[0]; if(contact)this.form.patchValue({customer:contact.name?.[0]??'',phone:contact.tel?.[0]??''}); } catch(error) { if(!(error instanceof DOMException)||error.name!=='AbortError')this.notify('Unable to open contacts on this device.',true); } }
  onProductTypeChange(event:Event):void { const cakeType=(event.target as HTMLSelectElement).value; this.form.controls.cakeType.setValue(cakeType); this.form.patchValue(cakeType==='Hamper'?{flavour:'',cakeMessage:'',cakeWeight:'',quantity:1}:this.isPieceProduct(cakeType)?{cakeWeight:'',quantity:1}:{quantity:1}); this.onProductTypeChangeValue(cakeType); this.refreshRequiredFields(); }
  private onProductTypeChangeValue(cakeType:string):void { this.form.controls.flavour.setValidators(cakeType==='Hamper'?[]:[Validators.required]); this.form.controls.flavour.updateValueAndValidity(); }
  onSetupChange(event:Event):void { const value=(event.target as HTMLSelectElement).value as CakeOrder['setup']; this.form.controls.setup.setValue(value); if(value==='Delivery') this.deliveryModal.set(true); else { this.form.patchValue({deliveryAmount:0,deliveryCost:0,deliveredBy:'',deliveryMethod:'Delivery man',deliveryFeeType:'Free',deliveryBookedBy:'Client'}); this.deliveryModal.set(false); } this.refreshRequiredFields(); }
  refreshRequiredFields():void {
    const v=this.form.getRawValue();
    const required=(name:'address'|'cakeWeight'|'deliveredBy'|'deliveryExpense',enabled:boolean) => {
      const control=this.form.controls[name];
      control.setValidators(enabled?[Validators.required, ...(name==='deliveryExpense'?[Validators.min(0)]:[])]:name==='deliveryExpense'?[Validators.min(0)]:[]);
      control.updateValueAndValidity({emitEvent:false});
    };
    required('address',v.setup!=='Self pickup');
    required('cakeWeight',!!v.cakeType && v.cakeType!=='Hamper' && !this.isPieceProduct(v.cakeType));
    required('deliveredBy',v.setup==='Delivery');
    required('deliveryExpense',this.needsDeliveryExpense(v.setup,v.deliveryMethod) && (v.status==='Delivered'||v.status==='Closed'));
    this.form.controls.deliveryCost.setValidators(v.setup==='Delivery'&&v.deliveryFeeType==='Paid'&&(v.deliveryMethod==='Delivery man'||v.deliveryBookedBy==='Us')?[Validators.required,Validators.min(1)]:[Validators.min(0)]);
    this.form.controls.deliveryCost.updateValueAndValidity({emitEvent:false});
  }
  private scrollToFirstInvalid():void {
    requestAnimationFrame(()=>{
      const field=document.querySelector<HTMLElement>('.order-form-expanded .field:has(.ng-invalid.ng-touched), .order-form-expanded .client-picker.field-error');
      field?.scrollIntoView({behavior:'smooth',block:'center'});
      field?.querySelector<HTMLElement>('input, select, textarea')?.focus({preventScroll:true});
    });
  }
  onDeliveryMethodChange():void { if(this.form.controls.deliveryMethod.value==='Delivery man') this.form.controls.deliveryBookedBy.setValue('Us'); this.refreshRequiredFields(); }
  onDeliveryFeeTypeChange():void { if(this.form.controls.deliveryFeeType.value==='Free'){ this.form.controls.deliveryCost.setValue(0); this.form.controls.deliveryBookedBy.setValue('Client'); } this.refreshRequiredFields(); }
  onDeliveryBookingChange():void { if(this.form.controls.deliveryBookedBy.value==='Client' && this.form.controls.deliveryCost.value<0) this.form.controls.deliveryCost.setValue(0); this.refreshRequiredFields(); }
  confirmDelivery():void { const paid=this.form.controls.deliveryFeeType.value==='Paid'; const needsCost=paid&&(this.form.controls.deliveryMethod.value==='Delivery man'||this.form.controls.deliveryBookedBy.value==='Us'); this.refreshRequiredFields(); if(!this.form.controls.deliveredBy.value.trim() || (needsCost&&this.form.controls.deliveryCost.value<=0)){ this.form.controls.deliveredBy.markAsTouched();this.form.controls.deliveryCost.markAsTouched();this.notify('Add who is delivering and the delivery cost when required.',true); return; } this.deliveryModal.set(false); }
  openPayment(order:CakeOrder):void {this.paymentTarget.set(order);this.paymentForm.reset({amount:this.balance(order),date:this.today(),type:order.status==='Delivered'?'Delivery':'Advance'});}
  async recordPayment():Promise<void> {const order=this.paymentTarget();const value=this.paymentForm.getRawValue();if(!order||this.paymentForm.invalid||value.amount>this.balance(order)){this.paymentForm.markAllAsTouched();this.notify('Enter a valid amount up to the balance due and a payment date.',true);return;}try{await this.data.recordOrderPayment(order.id,{id:crypto.randomUUID(),amount:Number(value.amount),date:value.date,type:value.type});this.paymentTarget.set(null);this.notify(value.amount===this.balance(order)&&order.status==='Delivered'?'Payment recorded. Order closed.':'Payment recorded.');}catch{this.notify('Unable to record payment. Check the latest balance.',true);}}
  paymentTimeline(order:CakeOrder):OrderPayment[] {return [...(order.payments??[])].sort((a,b)=>a.date.localeCompare(b.date));}
  earlierPaid(order:CakeOrder):number {return Math.max(0,order.advancePaid-(order.payments??[]).reduce((sum,payment)=>sum+payment.amount,0));}
  setFilter(e: Event):void { this.filter.set((e.target as HTMLSelectElement).value as OrderFilter); }
  setPeriod(value: OrderPeriod):void { if(value==='active'){this.clearFilters();this.period.set('active');return;} this.period.set(value); this.selectedMonth.set(''); }
  setPeriodFromSelect(event:Event):void { this.setPeriod((event.target as HTMLSelectElement).value as OrderPeriod); }
  setExactMonth(event:Event):void { this.selectedMonth.set((event.target as HTMLSelectElement).value); }
  setCustomStart(event:Event):void { this.customStart.set((event.target as HTMLInputElement).value); this.period.set('custom'); this.selectedMonth.set(''); }
  setCustomEnd(event:Event):void { this.customEnd.set((event.target as HTMLInputElement).value); this.period.set('custom'); this.selectedMonth.set(''); }
  setOrderSearch(event:Event):void { this.orderSearch.set((event.target as HTMLInputElement).value); }
  setLocationFilter(event:Event):void { this.locationFilter.set((event.target as HTMLSelectElement).value as 'all'|'Inside complex'|'Outside complex'); }
  setReferralFilter(event:Event):void { this.referralFilter.set((event.target as HTMLSelectElement).value as 'all'|'yes'|'no'); }
  showMetric(metric:'active'|'value'|'collected'|'due'):void { this.clearFilters(); if(metric==='active')this.setPeriod('active'); else {this.setPeriod('all');this.metricFilter.set(metric);} this.scrollToOrders(); }
  setColorFilter(color:Exclude<OrderColorFilter,'all'>):void {if(this.colorFilter()===color){this.clearFilters();return;}this.clearFilters();this.period.set('all');this.colorFilter.set(color);this.scrollToOrders();}
  clearFilters():void { this.period.set('current');this.selectedMonth.set('');this.filter.set('all');this.orderSearch.set('');this.customStart.set('');this.customEnd.set('');this.locationFilter.set('all');this.referralFilter.set('all');this.metricFilter.set('all');this.colorFilter.set('all'); }
  private scrollToOrders():void { setTimeout(()=>document.querySelector('.data-panel')?.scrollIntoView({behavior:'smooth',block:'start'})); }
  exportOrders():void { const rows=this.filtered().map(order=>[order.dueDate,order.customer,order.phone,order.cakeType,order.flavour,order.setup,order.deliveryMethod,order.deliveryFeeType,order.deliveryBookedBy,order.deliveryCost,order.deliveryAmount,this.deliveryExpenseValue(order),this.total(order),order.advancePaid,this.balance(order),order.status]); this.downloadCsv(`mannam-orders-${this.today()}.csv`,[['Date','Customer','Phone','Product','Flavour','Fulfilment','Delivery method','Free/Paid','Booked by','Tracked delivery cost','Delivery income','Delivery/setup expense','Total','Paid','Due','Status'],...rows]); }
  async setStatus(id:string,e:Event):Promise<void> {
    const order=this.data.orders().find(item=>item.id===id); if(!order)return;
    const select=e.target as HTMLSelectElement; const requested=select.value as OrderStatus;
    if(this.needsDeliveryExpense(order.setup,order.deliveryMethod)&&requested==='Delivered'){
      select.value=order.status;
      this.deliveryExpenseForm.reset({amount:order.deliveryExpense&&order.deliveryExpense>0?order.deliveryExpense:order.setup==='Delivery'&&order.deliveryBookedBy==='Us'?order.deliveryCost:0});
      this.deliveryExpenseTarget.set(order);
      return;
    }
    try { const status=await this.data.updateOrderStatus(id,requested); this.notify(status==='Closed'?'Delivered and fully paid — order closed.':'Order status updated.'); } catch { select.value=order.status; this.notify('Unable to update order status.', true); }
  }
  async confirmDeliveryExpense():Promise<void> {
    const order=this.deliveryExpenseTarget(); const amount=this.deliveryExpenseForm.controls.amount.value;
    if(!order||this.deliveryExpenseForm.invalid||amount===null){this.deliveryExpenseForm.markAllAsTouched();return;}
    try {const status=await this.data.updateOrderStatus(order.id,'Delivered',Number(amount));this.deliveryExpenseTarget.set(null);this.notify(status==='Closed'?'Expense saved. Order closed.':'Expense saved. Order delivered.');}
    catch {this.notify('Unable to save setup expense and delivery status.',true);}
  }
  total(o:{amount:number;deliveryAmount:number}):number { return o.amount+o.deliveryAmount; }
  balance(o:{amount:number;deliveryAmount:number;advancePaid:number}):number { return Math.max(0,this.total(o)-o.advancePaid); }
  isPieceProduct(cakeType=this.form.controls.cakeType.value):boolean { return cakeType === 'Cupcake' || cakeType === 'Brownie'; }
  needsDeliveryExpense(setup:CakeOrder['setup'],method:CakeOrder['deliveryMethod']):boolean { return setup==='Cake setup'||setup==='Delivery'&&(method==='Cab'||method==='Porter'); }
  deliveryExpenseValue(order:CakeOrder):number { return Number(order.deliveryExpense??((order.status==='Delivered'||order.status==='Closed')&&order.setup==='Delivery'&&order.deliveryBookedBy==='Us'?order.deliveryCost:0))||0; }
  orderSize(order:Pick<CakeOrder,'cakeType'|'cakeWeight'|'quantity'>):string { return order.cakeType==='Hamper'?'':this.isPieceProduct(order.cakeType) ? `${order.quantity} piece${order.quantity===1?'':'s'}` : order.cakeWeight; }
  reminderOrders(daysAhead:number):CakeOrder[] {const dueDate=this.reminderDate(daysAhead);return this.data.orders().filter(order=>order.dueDate===dueDate&&['Confirmed','In progress','Ready'].includes(order.status)).sort((a,b)=>a.customer.localeCompare(b.customer));}
  jumpToOrder(order:CakeOrder):void {
    this.clearFilters();
    if (!order.dueDate.startsWith(this.reminderDate(0).slice(0,7))) this.selectedMonth.set(order.dueDate.slice(0,7));
    this.highlightedOrder.set(order.id);
    requestAnimationFrame(() => {
      const target=document.getElementById(`order-${order.id}`);
      target?.scrollIntoView({behavior:'smooth',block:'center'});
      target?.focus({preventScroll:true});
      setTimeout(() => { if(this.highlightedOrder()===order.id)this.highlightedOrder.set(null); },3000);
    });
  }
  private reminderDate(daysAhead:number):string {const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());const values=Object.fromEntries(parts.map(part=>[part.type,part.value]));const date=new Date(Date.UTC(Number(values['year']),Number(values['month'])-1,Number(values['day'])+daysAhead));return date.toISOString().slice(0,10);}
  isSoon(date:string):boolean {const today=this.today();const end=new Date(`${today}T00:00:00`);end.setDate(end.getDate()+3);const until=`${end.getFullYear()}-${String(end.getMonth()+1).padStart(2,'0')}-${String(end.getDate()).padStart(2,'0')}`;return date>=today&&date<=until;}
  orderTone(order:CakeOrder):string{const today=this.today();if(order.dueDate<today){if(order.status==='Closed')return 'past-closed';if(this.balance(order)>0)return 'past-due';return 'past-open';}if(order.status==='Closed')return 'past-closed';return order.dueDate===today?'today':this.isSoon(order.dueDate)?'soon':'future';}
  toneLabel(order:CakeOrder):string{switch(this.orderTone(order)){case 'today':return 'Due today';case 'soon':return 'Next 3 days';case 'future':return 'Future order';case 'past-closed':return 'Closed';case 'past-due':return 'Past · payment due';default:return 'Past · update status';}}
  currency(v:number):string { return new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:2}).format(v); }
  formatPaymentDate(date:string):string {return new Intl.DateTimeFormat('en-IN',{day:'numeric',month:'short',year:'numeric'}).format(new Date(`${date}T00:00:00`));}
  private defaults(){return {customer:'',phone:'',address:'',occasion:'',flavour:'',cakeType:'',setup:'Self pickup' as CakeOrder['setup'],deliveredBy:'',deliveryMethod:'Cab' as CakeOrder['deliveryMethod'],deliveryFeeType:'Paid' as CakeOrder['deliveryFeeType'],deliveryBookedBy:'Client' as CakeOrder['deliveryBookedBy'],deliveryCost:0,quantity:1,cakeWeight:'',cakeMessage:'',amount:null,advancePaid:0,paymentDate:this.today(),deliveryAmount:0,extraExpenses:0,deliveryExpense:null,dueDate:this.today(),status:'Confirmed' as OrderStatus,location:'Outside complex' as CakeOrder['location'],residentReferral:false};}
  private today():string{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}
  private periodRange(period:Exclude<OrderPeriod,'all'|'active'|'custom'>):{start:Date;end:Date}{ const now=new Date(); if(period==='current') return {start:new Date(now.getFullYear(),now.getMonth(),1),end:new Date(now.getFullYear(),now.getMonth()+1,0,23,59,59)}; if(period.startsWith('last')){const months=Number(period.slice(4));return {start:new Date(now.getFullYear(),now.getMonth()-months,1),end:new Date(now.getFullYear(),now.getMonth(),0,23,59,59)}} const months=period==='next1'?1:3; return {start:new Date(now.getFullYear(),now.getMonth()+1,1),end:new Date(now.getFullYear(),now.getMonth()+months+1,0,23,59,59)}; }
  private downloadCsv(filename:string,rows:(string|number)[][]):void { const csv=rows.map(row=>row.map(value=>`"${String(value).replace(/"/g,'""')}"`).join(',')).join('\r\n'); const url=URL.createObjectURL(new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'})); const link=document.createElement('a'); link.href=url; link.download=filename; link.click(); URL.revokeObjectURL(url); }
  private notify(m:string,error=false):void { this.toast.set(`${error?'error':'success'}:${m}`); setTimeout(()=>this.toast.set(''),3000); }
}
