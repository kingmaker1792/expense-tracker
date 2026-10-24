import { SlicePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { CakeOrder, FirebaseDataService, OrderStatus } from '../../firebase-data.service';

@Component({ selector: 'app-orders', imports: [ReactiveFormsModule, SlicePipe], templateUrl: './orders.html' })
export class Orders {
  private readonly fb = inject(FormBuilder); readonly data = inject(FirebaseDataService);
  readonly showForm = signal(false); readonly deliveryModal = signal(false); readonly editingId = signal<string|null>(null); readonly deleteTarget = signal<CakeOrder|null>(null);
  readonly filter = signal<'all' | OrderStatus>('all'); readonly months = signal<1|3|6|12>(1); readonly toast = signal('');
  readonly filtered = computed(() => {
    const now = new Date(); const start = new Date(now.getFullYear(), now.getMonth() - this.months() + 1, 1); const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
    return this.data.orders().filter(o => { const date = new Date(`${o.dueDate}T00:00:00`); return date >= start && date <= end; })
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
  readonly rangeLabel = computed(() => { const now=new Date(); const start=new Date(now.getFullYear(),now.getMonth()-this.months()+1,1); const fmt=new Intl.DateTimeFormat('en-IN',{month:'short',year:'numeric'}); return this.months()===1 ? fmt.format(now) : `${fmt.format(start)} – ${fmt.format(now)}`; });
  readonly form = this.fb.nonNullable.group({
    customer: ['', Validators.required], phone: [''], address: [''], occasion: ['', Validators.required],
    flavour: ['', Validators.required], cakeType: ['', Validators.required], setup: ['Self pickup' as CakeOrder['setup'], Validators.required], deliveredBy: [''],
    quantity: [1, [Validators.required, Validators.min(1)]], cakeWeight: ['', Validators.required], cakeMessage: [''],
    amount: [null as number | null, [Validators.required, Validators.min(1)]], advancePaid: [0, Validators.min(0)], deliveryAmount: [0, Validators.min(0)], extraExpenses: [0, Validators.min(0)],
    dueDate: [this.today(), Validators.required], status: ['Confirmed' as OrderStatus, Validators.required],
  });

  async save(): Promise<void> {
    const v=this.form.getRawValue();
    if (this.form.invalid || (v.setup !== 'Self pickup' && !v.address.trim()) || (v.setup === 'Delivery' && !v.deliveredBy.trim())) { this.form.markAllAsTouched(); this.notify('Please complete all required order details.', true); return; }
    const total=Number(v.amount)+Number(v.deliveryAmount); const paid=Number(v.advancePaid); const status:OrderStatus = paid >= total ? 'Closed' : v.status === 'Closed' ? 'Delivered' : v.status;
    const id=this.editingId(); const record={ ...v, id:id??'', amount:Number(v.amount), advancePaid:paid, deliveryAmount:v.setup==='Delivery'?Number(v.deliveryAmount):0, deliveredBy:v.setup==='Delivery'?v.deliveredBy:'', extraExpenses:Number(v.extraExpenses), quantity:Number(v.quantity), status } as CakeOrder;
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
  onSetupChange(event:Event):void { const value=(event.target as HTMLSelectElement).value as CakeOrder['setup']; this.form.controls.setup.setValue(value); if(value==='Delivery') this.deliveryModal.set(true); else { this.form.patchValue({deliveryAmount:0,deliveredBy:''}); this.deliveryModal.set(false); } }
  confirmDelivery():void { if(!this.form.controls.deliveredBy.value.trim()){ this.notify('Please enter who will deliver the order.',true); return; } this.deliveryModal.set(false); }
  async markPaid(order:CakeOrder):Promise<void> { try { await this.data.markOrderFullyPaid(order.id); this.notify('Payment completed. Due is ₹0 and order is now closed.'); } catch { this.notify('Unable to update payment.', true); } }
  setFilter(e: Event):void { this.filter.set((e.target as HTMLSelectElement).value as 'all'|OrderStatus); }
  setMonths(value: 1|3|6|12):void { this.months.set(value); }
  async setStatus(id:string,e:Event):Promise<void> { try { await this.data.updateOrderStatus(id,(e.target as HTMLSelectElement).value as OrderStatus); this.notify('Order status updated. Payment is still required before closing.'); } catch { this.notify('Unable to update order status.', true); } }
  total(o:{amount:number;deliveryAmount:number}):number { return o.amount+o.deliveryAmount; }
  balance(o:{amount:number;deliveryAmount:number;advancePaid:number}):number { return Math.max(0,this.total(o)-o.advancePaid); }
  currency(v:number):string { return new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:0}).format(v); }
  private defaults(){return {customer:'',phone:'',address:'',occasion:'',flavour:'',cakeType:'',setup:'Self pickup' as CakeOrder['setup'],deliveredBy:'',quantity:1,cakeWeight:'',cakeMessage:'',amount:null,advancePaid:0,deliveryAmount:0,extraExpenses:0,dueDate:this.today(),status:'Confirmed' as OrderStatus};}
  private today():string{return new Date().toISOString().slice(0,10)}
  private notify(m:string,error=false):void { this.toast.set(`${error?'error':'success'}:${m}`); setTimeout(()=>this.toast.set(''),3000); }
}
