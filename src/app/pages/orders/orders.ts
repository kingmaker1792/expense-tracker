import { SlicePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { CakeOrder, FirebaseDataService, OrderStatus } from '../../firebase-data.service';

@Component({ selector: 'app-orders', imports: [ReactiveFormsModule, SlicePipe], templateUrl: './orders.html' })
export class Orders {
  private readonly fb = inject(FormBuilder); readonly data = inject(FirebaseDataService);
  readonly weights = Array.from({ length: 60 }, (_, index) => `${(index + 1) / 2} lb`);
  readonly showForm = signal(false); readonly deliveryModal = signal(false); readonly editingId = signal<string|null>(null); readonly deleteTarget = signal<CakeOrder|null>(null);
  readonly filter = signal<'all' | OrderStatus>('all'); readonly months = signal<1|3|6|12|'all'>(1); readonly selectedMonth = signal(''); readonly toast = signal('');
  readonly filtered = computed(() => {
    const now = new Date(); const period = this.months(); const exactMonth=this.selectedMonth(); const start = new Date(now.getFullYear(), now.getMonth() - (period==='all'?12:period) + 1, 1); const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
    return this.data.orders().filter(o => { if(exactMonth) return o.dueDate.startsWith(exactMonth); const date = new Date(`${o.dueDate}T00:00:00`); return date >= start && date <= end; })
      .filter(o => this.filter() === 'all' || o.status === this.filter()).sort((a,b) => b.dueDate.localeCompare(a.dueDate));
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
  readonly monthOptions = computed(() => { const now=new Date(); const start=this.monthKey(new Date(now.getFullYear(),now.getMonth()-11,1)); const end=this.monthKey(now); return [...new Set(this.data.orders().map(order=>order.dueDate.slice(0,7)).filter(key=>/^\d{4}-\d{2}$/.test(key)&&key>=start&&key<=end))].sort((a,b)=>b.localeCompare(a)).map(value=>({value,label:new Intl.DateTimeFormat('en-IN',{month:'long',year:'numeric'}).format(new Date(`${value}-01T00:00:00`))})); });
  readonly rangeLabel = computed(() => { const exact=this.selectedMonth(); if(exact) return new Intl.DateTimeFormat('en-IN',{month:'long',year:'numeric'}).format(new Date(`${exact}-01T00:00:00`)); const period=this.months(); if(period==='all') return 'Last 12 months'; const now=new Date(); const start=new Date(now.getFullYear(),now.getMonth()-period+1,1); const fmt=new Intl.DateTimeFormat('en-IN',{month:'short',year:'numeric'}); return period===1 ? fmt.format(now) : `${fmt.format(start)} – ${fmt.format(now)}`; });
  readonly form = this.fb.nonNullable.group({
    customer: ['', Validators.required], phone: ['', [Validators.required, Validators.minLength(6), Validators.maxLength(20)]], address: [''], occasion: ['', Validators.required],
    flavour: ['', Validators.required], cakeType: ['', Validators.required], setup: ['Self pickup' as CakeOrder['setup'], Validators.required], deliveredBy: [''],
    quantity: [1, [Validators.required, Validators.min(1)]], cakeWeight: [''], cakeMessage: [''],
    amount: [null as number | null, [Validators.required, Validators.min(1)]], advancePaid: [0, Validators.min(0)], deliveryAmount: [0, Validators.min(0)], extraExpenses: [0, Validators.min(0)],
    dueDate: [this.today(), Validators.required], status: ['Confirmed' as OrderStatus, Validators.required],
  });

  async save(): Promise<void> {
    const v=this.form.getRawValue();
    const pieceProduct=this.isPieceProduct(v.cakeType);
    if (this.form.invalid || (!pieceProduct && !v.cakeWeight) || (v.setup !== 'Self pickup' && !v.address.trim()) || (v.setup === 'Delivery' && !v.deliveredBy.trim())) { this.form.markAllAsTouched(); this.notify('Please complete all required order details.', true); return; }
    const total=Number(v.amount)+Number(v.deliveryAmount); const paid=Number(v.advancePaid); const status:OrderStatus = paid >= total ? 'Closed' : v.status === 'Closed' ? 'Delivered' : v.status;
    const id=this.editingId(); const record={ ...v, id:id??'', phone:v.phone.trim(), amount:Number(v.amount), advancePaid:paid, deliveryAmount:v.setup==='Delivery'?Number(v.deliveryAmount):0, deliveredBy:v.setup==='Delivery'?v.deliveredBy:'', extraExpenses:Number(v.extraExpenses), quantity:pieceProduct?Number(v.quantity):1, cakeWeight:pieceProduct?'':v.cakeWeight, status } as CakeOrder;
    try { if(id) await this.data.updateOrder(record); else { const {id:_,...newOrder}=record; await this.data.addOrder(newOrder); } this.notify(id ? 'Order updated successfully.' : 'Cake order added successfully.'); this.closeForm(); } catch { this.notify('Unable to save order. Check Firebase access.', true); }
  }
  edit(order:CakeOrder):void { this.editingId.set(order.id); this.form.reset(order); this.showForm.set(true); window.scrollTo({top:80,behavior:'smooth'}); }
  requestRemove(order:CakeOrder):void { this.deleteTarget.set(order); }
  async confirmRemove():Promise<void> {
    const order=this.deleteTarget(); if(!order) return;
    this.deleteTarget.set(null);
    try { await this.data.deleteOrder(order.id); this.notify(`${order.customer}'s order deleted.`); }
    catch { this.notify('Unable to delete order.', true); }
  }
  closeForm():void { this.showForm.set(false); this.editingId.set(null); this.form.reset(this.defaults()); }
  onProductTypeChange(event:Event):void { const cakeType=(event.target as HTMLSelectElement).value; this.form.controls.cakeType.setValue(cakeType); this.form.patchValue(this.isPieceProduct(cakeType)?{cakeWeight:'',quantity:1}:{quantity:1}); }
  onSetupChange(event:Event):void { const value=(event.target as HTMLSelectElement).value as CakeOrder['setup']; this.form.controls.setup.setValue(value); if(value==='Delivery') this.deliveryModal.set(true); else { this.form.patchValue({deliveryAmount:0,deliveredBy:''}); this.deliveryModal.set(false); } }
  confirmDelivery():void { if(!this.form.controls.deliveredBy.value.trim()){ this.notify('Please enter who will deliver the order.',true); return; } this.deliveryModal.set(false); }
  async markPaid(order:CakeOrder):Promise<void> { try { await this.data.markOrderFullyPaid(order.id); this.notify('Payment completed. Due is ₹0 and order is now closed.'); } catch { this.notify('Unable to update payment.', true); } }
  setFilter(e: Event):void { this.filter.set((e.target as HTMLSelectElement).value as 'all'|OrderStatus); }
  setMonths(value: 1|3|6|12|'all'):void { this.months.set(value); this.selectedMonth.set(''); }
  setExactMonth(event:Event):void { this.selectedMonth.set((event.target as HTMLSelectElement).value); }
  async setStatus(id:string,e:Event):Promise<void> { try { await this.data.updateOrderStatus(id,(e.target as HTMLSelectElement).value as OrderStatus); this.notify('Order status updated. Payment is still required before closing.'); } catch { this.notify('Unable to update order status.', true); } }
  total(o:{amount:number;deliveryAmount:number}):number { return o.amount+o.deliveryAmount; }
  balance(o:{amount:number;deliveryAmount:number;advancePaid:number}):number { return Math.max(0,this.total(o)-o.advancePaid); }
  isPieceProduct(cakeType=this.form.controls.cakeType.value):boolean { return cakeType === 'Cupcake' || cakeType === 'Brownie'; }
  orderSize(order:Pick<CakeOrder,'cakeType'|'cakeWeight'|'quantity'>):string { return this.isPieceProduct(order.cakeType) ? `${order.quantity} piece${order.quantity===1?'':'s'}` : order.cakeWeight; }
  currency(v:number):string { return new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:0}).format(v); }
  private defaults(){return {customer:'',phone:'',address:'',occasion:'',flavour:'',cakeType:'',setup:'Self pickup' as CakeOrder['setup'],deliveredBy:'',quantity:1,cakeWeight:'',cakeMessage:'',amount:null,advancePaid:0,deliveryAmount:0,extraExpenses:0,dueDate:this.today(),status:'Confirmed' as OrderStatus};}
  private today():string{return new Date().toISOString().slice(0,10)}
  private monthKey(date:Date):string{return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}`}
  private notify(m:string,error=false):void { this.toast.set(`${error?'error':'success'}:${m}`); setTimeout(()=>this.toast.set(''),3000); }
}
