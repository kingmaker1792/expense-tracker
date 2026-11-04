import { SlicePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { CakeOrder, ClientHistory, FirebaseDataService, OrderStatus } from '../../firebase-data.service';

type OrderFilter = 'all' | OrderStatus | 'delivered-paid' | 'delivered-unpaid';
type OrderPeriod = 'current' | 'last1' | 'last3' | 'last6' | 'next1' | 'next3' | 'active' | 'custom' | 'all';
type ContactPickerNavigator = Navigator & { contacts?: { select(fields: string[], options: { multiple: boolean }): Promise<Array<{ name?: string[]; tel?: string[] }>> } };

@Component({ selector: 'app-orders', imports: [ReactiveFormsModule, SlicePipe], templateUrl: './orders.html' })
export class Orders {
  private readonly fb = inject(FormBuilder); readonly data = inject(FirebaseDataService);
  private readonly route = inject(ActivatedRoute);
  readonly weights = Array.from({ length: 60 }, (_, index) => `${(index + 1) / 2} lb`);
  readonly showForm = signal(false); readonly deliveryModal = signal(false); readonly editingId = signal<string|null>(null); readonly deleteTarget = signal<CakeOrder|null>(null);
  readonly filter = signal<OrderFilter>('all'); readonly period = signal<OrderPeriod>('current'); readonly selectedMonth = signal(''); readonly toast = signal('');
  readonly customStart = signal(''); readonly customEnd = signal(''); readonly orderSearch = signal('');
  readonly clientMode = signal<'existing'|'new'>('existing'); readonly clientSearch = signal(''); readonly clientPickerOpen = signal(false);
  readonly contactPickerSupported=typeof navigator!=='undefined' && !!(navigator as ContactPickerNavigator).contacts?.select;
  constructor() { this.route.queryParamMap.subscribe(params => { if(params.get('view')==='active') this.setPeriod('active'); }); }
  readonly clientMatches = computed(() => { const q=this.clientSearch().trim().toLocaleLowerCase(); return this.data.clients().filter(client=>!q||`${client.name} ${client.phone}`.toLocaleLowerCase().includes(q)).slice(0,8); });
  readonly filtered = computed(() => {
    const exactMonth=this.selectedMonth(); const period=this.period(); const range=period==='all'||period==='active'||period==='custom'?null:this.periodRange(period); const q=this.orderSearch().trim().toLocaleLowerCase();
    return this.data.orders().filter(o => { if(exactMonth) return o.dueDate.startsWith(exactMonth); if(period==='active') return o.status!=='Closed'; if(period==='custom') return (!this.customStart()||o.dueDate>=this.customStart())&&(!this.customEnd()||o.dueDate<=this.customEnd()); if(!range) return true; const date = new Date(`${o.dueDate}T00:00:00`); return date >= range.start && date <= range.end; })
      .filter(o => !q || `${o.customer} ${o.phone} ${o.cakeType} ${o.flavour} ${o.occasion} ${o.cakeMessage}`.toLocaleLowerCase().includes(q))
      .filter(o => { const filter=this.filter(); if(filter==='all') return true; if(filter==='delivered-paid') return (o.status==='Delivered'||o.status==='Closed')&&this.balance(o)===0; if(filter==='delivered-unpaid') return o.status==='Delivered'&&this.balance(o)>0; return o.status===filter; }).sort((a,b) => b.dueDate.localeCompare(a.dueDate));
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
    amount: [null as number | null, [Validators.required, Validators.min(1)]], advancePaid: [0, Validators.min(0)], deliveryAmount: [0, Validators.min(0)], extraExpenses: [0, Validators.min(0)],
    dueDate: [this.today(), Validators.required], status: ['Confirmed' as OrderStatus, Validators.required],
  });

  async save(): Promise<void> {
    const v=this.form.getRawValue();
    const pieceProduct=this.isPieceProduct(v.cakeType);
    const deliveryNeedsCost=v.setup==='Delivery'&&v.deliveryFeeType==='Paid'&&(v.deliveryMethod==='Delivery man'||v.deliveryBookedBy==='Us');
    if (this.form.invalid || (v.cakeType!=='Hamper' && !pieceProduct && !v.cakeWeight) || (v.setup !== 'Self pickup' && !v.address.trim()) || (v.setup === 'Delivery' && (!v.deliveredBy.trim() || (deliveryNeedsCost && Number(v.deliveryCost)<=0)))) { this.form.markAllAsTouched(); this.notify('Please complete all required order and delivery details.', true); return; }
    const trackedDeliveryCost=v.setup==='Delivery'&&v.deliveryFeeType==='Paid'?Number(v.deliveryCost):0; const includedDeliveryAmount=v.setup==='Delivery'&&v.deliveryFeeType==='Paid'&&(v.deliveryMethod==='Delivery man'||v.deliveryBookedBy==='Us')?trackedDeliveryCost:0; const total=Number(v.amount)+includedDeliveryAmount; const paid=Number(v.advancePaid); const status:OrderStatus = v.status === 'Delivered' && paid >= total ? 'Closed' : v.status === 'Closed' ? 'Delivered' : v.status;
    const id=this.editingId(); const record={ ...v, id:id??'', phone:v.phone.trim(), amount:Number(v.amount), advancePaid:paid, deliveryAmount:includedDeliveryAmount, deliveryCost:trackedDeliveryCost, deliveryMethod:v.setup==='Delivery'?v.deliveryMethod:'Delivery man', deliveryFeeType:v.setup==='Delivery'?v.deliveryFeeType:'Free', deliveryBookedBy:v.setup==='Delivery'&&v.deliveryMethod!=='Delivery man'&&v.deliveryFeeType==='Paid'?v.deliveryBookedBy:v.deliveryMethod==='Delivery man'&&v.deliveryFeeType==='Paid'?'Us':'Client', deliveredBy:v.setup==='Delivery'?v.deliveredBy:'', extraExpenses:Number(v.extraExpenses), flavour:v.cakeType==='Hamper'?'':v.flavour, cakeMessage:v.cakeType==='Hamper'?'':v.cakeMessage, quantity:pieceProduct?Number(v.quantity):1, cakeWeight:pieceProduct||v.cakeType==='Hamper'?'':v.cakeWeight, status } as CakeOrder;
    try { if(id) await this.data.updateOrder(record); else { const {id:_,...newOrder}=record; await this.data.addOrder(newOrder); } this.notify(id ? 'Order updated successfully.' : 'Cake order added successfully.'); this.closeForm(); } catch { this.notify('Unable to save order. Check Firebase access.', true); }
  }
  openNewOrder():void { this.closeForm(); this.clientMode.set(this.data.clients().length?'existing':'new'); this.showForm.set(true); }
  edit(order:CakeOrder):void { this.editingId.set(order.id); this.form.reset(order); this.clientMode.set('new'); this.clientSearch.set(''); this.clientPickerOpen.set(false); this.showForm.set(true); window.scrollTo({top:80,behavior:'smooth'}); }
  requestRemove(order:CakeOrder):void { this.deleteTarget.set(order); }
  async confirmRemove():Promise<void> {
    const order=this.deleteTarget(); if(!order) return;
    this.deleteTarget.set(null);
    try { await this.data.deleteOrder(order.id); this.notify(`${order.customer}'s order deleted.`); }
    catch { this.notify('Unable to delete order.', true); }
  }
  closeForm():void { this.showForm.set(false); this.editingId.set(null); this.clientSearch.set(''); this.clientPickerOpen.set(false); this.form.reset(this.defaults()); }
  updateClientSearch(event:Event):void { this.clientSearch.set((event.target as HTMLInputElement).value); this.form.patchValue({customer:'',phone:'',address:''}); this.clientPickerOpen.set(true); }
  selectClient(client:ClientHistory):void { this.form.patchValue({customer:client.name,phone:client.phone,address:client.address}); this.clientSearch.set(`${client.name} · ${client.phone}`); this.clientPickerOpen.set(false); }
  useNewClient():void { const name=this.form.controls.customer.value?'':this.clientSearch().trim(); this.clientMode.set('new'); this.clientPickerOpen.set(false); this.form.patchValue({customer:name,phone:'',address:''}); }
  useExistingClient():void { this.clientMode.set('existing'); this.clientSearch.set(''); this.clientPickerOpen.set(false); this.form.patchValue({customer:'',phone:'',address:''}); }
  async pickContact():Promise<void> { try { const contacts=await (navigator as ContactPickerNavigator).contacts?.select(['name','tel'],{multiple:false}); const contact=contacts?.[0]; if(contact)this.form.patchValue({customer:contact.name?.[0]??'',phone:contact.tel?.[0]??''}); } catch(error) { if(!(error instanceof DOMException)||error.name!=='AbortError')this.notify('Unable to open contacts on this device.',true); } }
  onProductTypeChange(event:Event):void { const cakeType=(event.target as HTMLSelectElement).value; this.form.controls.cakeType.setValue(cakeType); this.form.patchValue(cakeType==='Hamper'?{flavour:'',cakeMessage:'',cakeWeight:'',quantity:1}:this.isPieceProduct(cakeType)?{cakeWeight:'',quantity:1}:{quantity:1}); this.form.controls.flavour.setValidators(cakeType==='Hamper'?[]:[Validators.required]); this.form.controls.flavour.updateValueAndValidity(); }
  onSetupChange(event:Event):void { const value=(event.target as HTMLSelectElement).value as CakeOrder['setup']; this.form.controls.setup.setValue(value); if(value==='Delivery') this.deliveryModal.set(true); else { this.form.patchValue({deliveryAmount:0,deliveryCost:0,deliveredBy:'',deliveryMethod:'Delivery man',deliveryFeeType:'Free',deliveryBookedBy:'Client'}); this.deliveryModal.set(false); } }
  onDeliveryMethodChange():void { if(this.form.controls.deliveryMethod.value==='Delivery man') this.form.controls.deliveryBookedBy.setValue('Us'); }
  onDeliveryFeeTypeChange():void { if(this.form.controls.deliveryFeeType.value==='Free'){ this.form.controls.deliveryCost.setValue(0); this.form.controls.deliveryBookedBy.setValue('Client'); } }
  onDeliveryBookingChange():void { if(this.form.controls.deliveryBookedBy.value==='Client' && this.form.controls.deliveryCost.value<0) this.form.controls.deliveryCost.setValue(0); }
  confirmDelivery():void { const paid=this.form.controls.deliveryFeeType.value==='Paid'; const needsCost=paid&&(this.form.controls.deliveryMethod.value==='Delivery man'||this.form.controls.deliveryBookedBy.value==='Us'); if(!this.form.controls.deliveredBy.value.trim() || (needsCost&&this.form.controls.deliveryCost.value<=0)){ this.notify('Add who is delivering and the delivery cost when required.',true); return; } this.deliveryModal.set(false); }
  async markPaid(order:CakeOrder):Promise<void> { try { await this.data.markOrderFullyPaid(order.id); this.notify(order.status==='Delivered'?'Payment completed and delivered order closed.':'Payment completed. The order stays open until delivery.'); } catch { this.notify('Unable to update payment.', true); } }
  setFilter(e: Event):void { this.filter.set((e.target as HTMLSelectElement).value as OrderFilter); }
  setPeriod(value: OrderPeriod):void { this.period.set(value); this.selectedMonth.set(''); if(value==='active') this.filter.set('all'); }
  setPeriodFromSelect(event:Event):void { this.setPeriod((event.target as HTMLSelectElement).value as OrderPeriod); }
  setExactMonth(event:Event):void { this.selectedMonth.set((event.target as HTMLSelectElement).value); }
  setCustomStart(event:Event):void { this.customStart.set((event.target as HTMLInputElement).value); this.period.set('custom'); this.selectedMonth.set(''); }
  setCustomEnd(event:Event):void { this.customEnd.set((event.target as HTMLInputElement).value); this.period.set('custom'); this.selectedMonth.set(''); }
  setOrderSearch(event:Event):void { this.orderSearch.set((event.target as HTMLInputElement).value); }
  exportOrders():void { const rows=this.filtered().map(order=>[order.dueDate,order.customer,order.phone,order.cakeType,order.flavour,order.setup,order.deliveryMethod,order.deliveryFeeType,order.deliveryBookedBy,order.deliveryCost,order.deliveryAmount,this.total(order),order.advancePaid,this.balance(order),order.status]); this.downloadCsv(`mannam-orders-${this.today()}.csv`,[['Date','Customer','Phone','Product','Flavour','Fulfilment','Delivery method','Free/Paid','Booked by','Tracked delivery cost','Cost included in total','Total','Paid','Due','Status'],...rows]); }
  async setStatus(id:string,e:Event):Promise<void> { try { const status=await this.data.updateOrderStatus(id,(e.target as HTMLSelectElement).value as OrderStatus); this.notify(status==='Closed'?'Delivered and fully paid — order closed.':'Order status updated.'); } catch { this.notify('Unable to update order status.', true); } }
  total(o:{amount:number;deliveryAmount:number}):number { return o.amount+o.deliveryAmount; }
  balance(o:{amount:number;deliveryAmount:number;advancePaid:number}):number { return Math.max(0,this.total(o)-o.advancePaid); }
  isPieceProduct(cakeType=this.form.controls.cakeType.value):boolean { return cakeType === 'Cupcake' || cakeType === 'Brownie'; }
  orderSize(order:Pick<CakeOrder,'cakeType'|'cakeWeight'|'quantity'>):string { return order.cakeType==='Hamper'?'':this.isPieceProduct(order.cakeType) ? `${order.quantity} piece${order.quantity===1?'':'s'}` : order.cakeWeight; }
  currency(v:number):string { return new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:0}).format(v); }
  private defaults(){return {customer:'',phone:'',address:'',occasion:'',flavour:'',cakeType:'',setup:'Self pickup' as CakeOrder['setup'],deliveredBy:'',deliveryMethod:'Cab' as CakeOrder['deliveryMethod'],deliveryFeeType:'Paid' as CakeOrder['deliveryFeeType'],deliveryBookedBy:'Client' as CakeOrder['deliveryBookedBy'],deliveryCost:0,quantity:1,cakeWeight:'',cakeMessage:'',amount:null,advancePaid:0,deliveryAmount:0,extraExpenses:0,dueDate:this.today(),status:'Confirmed' as OrderStatus};}
  private today():string{return new Date().toISOString().slice(0,10)}
  private periodRange(period:Exclude<OrderPeriod,'all'|'active'|'custom'>):{start:Date;end:Date}{ const now=new Date(); if(period==='current') return {start:new Date(now.getFullYear(),now.getMonth(),1),end:new Date(now.getFullYear(),now.getMonth()+1,0,23,59,59)}; if(period.startsWith('last')){const months=Number(period.slice(4));return {start:new Date(now.getFullYear(),now.getMonth()-months,1),end:new Date(now.getFullYear(),now.getMonth(),0,23,59,59)}} const months=period==='next1'?1:3; return {start:new Date(now.getFullYear(),now.getMonth()+1,1),end:new Date(now.getFullYear(),now.getMonth()+months+1,0,23,59,59)}; }
  private downloadCsv(filename:string,rows:(string|number)[][]):void { const csv=rows.map(row=>row.map(value=>`"${String(value).replace(/"/g,'""')}"`).join(',')).join('\r\n'); const url=URL.createObjectURL(new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'})); const link=document.createElement('a'); link.href=url; link.download=filename; link.click(); URL.revokeObjectURL(url); }
  private notify(m:string,error=false):void { this.toast.set(`${error?'error':'success'}:${m}`); setTimeout(()=>this.toast.set(''),3000); }
}
