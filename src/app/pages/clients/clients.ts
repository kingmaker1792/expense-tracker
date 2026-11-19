import { Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { CakeOrder, ClientHistory, FirebaseDataService } from '../../firebase-data.service';

type ContactPickerNavigator = Navigator & { contacts?: { select(fields: string[], options: { multiple: boolean }): Promise<Array<{ name?: string[]; tel?: string[] }>> } };

@Component({ selector: 'app-clients', imports: [RouterLink, ReactiveFormsModule], templateUrl: './clients.html' })
export class Clients {
  private readonly fb=inject(FormBuilder); readonly data=inject(FirebaseDataService);
  readonly search=signal(''); readonly selectedKey=signal(''); readonly locationFilter=signal<'all'|'Inside complex'|'Outside complex'>('all'); readonly referralFilter=signal<'all'|'yes'|'no'>('all'); readonly range=signal<'all'|'current'|'3'|'6'|'12'>('all'); readonly repeatFilter=signal<'all'|'repeat'|'one-order'>('all'); readonly showForm=signal(false); readonly editing=signal<ClientHistory|null>(null); readonly deleteTarget=signal<ClientHistory|null>(null); readonly toast=signal('');
  readonly contactPickerSupported=typeof navigator!=='undefined' && !!(navigator as ContactPickerNavigator).contacts?.select;
  readonly form=this.fb.nonNullable.group({name:['',Validators.required],phone:['',[Validators.required,Validators.minLength(6),Validators.maxLength(20)]],address:[''],location:['Outside complex' as ClientHistory['location']],residentReferral:[false]});
  readonly filteredClients=computed(()=>{const q=this.search().trim().toLocaleLowerCase();return this.data.clients().filter(client=>(this.locationFilter()==='all'||client.location===this.locationFilter())&&(this.referralFilter()==='all'||client.residentReferral===(this.referralFilter()==='yes'))&&(this.repeatFilter()==='all'||(this.repeatFilter()==='repeat'?this.clientOrders(client)>=2:this.clientOrders(client)===1))&&(!q||`${client.name} ${client.phone}`.toLocaleLowerCase().includes(q))).sort((a,b)=>this.clientValue(b)-this.clientValue(a)||a.name.localeCompare(b.name));});
  readonly locationStats=computed(()=>(['Inside complex','Outside complex'] as const).map(location=>{const clients=this.data.clients().filter(client=>client.location===location&&(this.referralFilter()==='all'||client.residentReferral===(this.referralFilter()==='yes')));const orders=clients.flatMap(client=>client.orders).filter(order=>this.inRange(order.dueDate));return {location,clients:clients.length,orders:orders.length,value:orders.reduce((sum,order)=>sum+order.amount+order.deliveryAmount,0)};}));
  readonly rangeValue=computed(()=>this.locationStats().reduce((sum,item)=>sum+item.value,0));
  readonly repeatStats=computed(()=>{const clients=this.data.clients().filter(client=>(this.locationFilter()==='all'||client.location===this.locationFilter())&&(this.referralFilter()==='all'||client.residentReferral===(this.referralFilter()==='yes')));const counts=clients.map(client=>this.clientOrders(client));const ordering=counts.filter(count=>count>0).length;const repeat=counts.filter(count=>count>=2).length;const oneOrder=counts.filter(count=>count===1).length;const totalOrders=counts.reduce((sum,count)=>sum+count,0);return {repeat,oneOrder,clientRate:ordering?Math.round(repeat/ordering*100):0,orderShare:totalOrders?Math.round((totalOrders-ordering)/totalOrders*100):0};});
  readonly hasFilters=computed(()=>!!this.search().trim()||this.locationFilter()!=='all'||this.referralFilter()!=='all'||this.range()!=='all'||this.repeatFilter()!=='all');
  readonly selectedClient=computed(()=>this.filteredClients().find(client=>client.key===this.selectedKey())??this.filteredClients()[0]??null);
  readonly lifetimeValue=computed(()=>this.data.clients().reduce((sum,client)=>sum+client.lifetimeValue,0));
  updateSearch(event:Event):void{this.search.set((event.target as HTMLInputElement).value);this.selectedKey.set('');}
  select(key:string):void{this.selectedKey.set(key);}
  clearFilters():void{this.search.set('');this.selectedKey.set('');this.locationFilter.set('all');this.referralFilter.set('all');this.range.set('all');this.repeatFilter.set('all');}
  setRepeatFilter(value:'repeat'|'one-order'):void{this.repeatFilter.set(this.repeatFilter()===value?'all':value);this.selectedKey.set('');document.querySelector('.client-directory')?.scrollIntoView({behavior:'smooth',block:'start'});}
  setRange(event:Event):void{this.range.set((event.target as HTMLSelectElement).value as 'all'|'current'|'3'|'6'|'12');}
  setReferral(event:Event):void{this.referralFilter.set((event.target as HTMLSelectElement).value as 'all'|'yes'|'no');}
  share(value:number):number{return this.rangeValue()?Math.round(value/this.rangeValue()*100):0;}
  clientValue(client:ClientHistory):number{return client.orders.filter(order=>this.inRange(order.dueDate)).reduce((sum,order)=>sum+order.amount+order.deliveryAmount,0);}
  clientOrders(client:ClientHistory):number{return client.orders.filter(order=>this.inRange(order.dueDate)).length;}
  private inRange(date:string):boolean{const range=this.range();if(range==='all')return true;const now=new Date();const start=new Date(now.getFullYear(),now.getMonth()-(range==='current'?0:Number(range)-1),1);const end=new Date(now.getFullYear(),now.getMonth()+1,0);return date>=this.dateKey(start)&&date<=this.dateKey(end);}
  private dateKey(date:Date):string{return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;}
  openAdd():void{this.editing.set(null);this.form.reset({name:'',phone:'',address:'',location:'Outside complex',residentReferral:false});this.showForm.set(true);}
  openEdit(client:ClientHistory):void{this.editing.set(client);this.form.reset({name:client.name,phone:client.phone,address:client.address,location:client.location,residentReferral:client.residentReferral});this.showForm.set(true);}
  closeForm():void{this.showForm.set(false);this.editing.set(null);}
  async save():Promise<void>{if(this.form.invalid){this.form.markAllAsTouched();this.notify('Add a valid client name and phone number.',true);return;}const value=this.form.getRawValue();const client={name:value.name.trim(),phone:value.phone.trim(),address:value.address.trim(),location:value.location,residentReferral:value.residentReferral};try{const current=this.editing();if(current?.profileId)await this.data.updateClient({id:current.profileId,...client});else await this.data.addClient(client);this.selectedKey.set(`${client.name.toLocaleLowerCase()}|${client.phone.replace(/\D/g,'')}`);this.closeForm();this.notify(current?'Client updated successfully.':'Client added successfully.');}catch{this.notify('Unable to save client.',true);}}
  async pickContact():Promise<void>{try{const contacts=await (navigator as ContactPickerNavigator).contacts?.select(['name','tel'],{multiple:false});const contact=contacts?.[0];if(contact)this.form.patchValue({name:contact.name?.[0]??'',phone:contact.tel?.[0]??''});}catch(error){if(!(error instanceof DOMException)||error.name!=='AbortError')this.notify('Unable to open contacts on this device.',true);}}
  requestDelete(client:ClientHistory):void{this.deleteTarget.set(client);}
  async confirmDelete():Promise<void>{const client=this.deleteTarget();if(!client)return;this.deleteTarget.set(null);try{await this.data.hideClient(client);if(this.selectedKey()===client.key)this.selectedKey.set('');this.notify(`${client.name} removed from the client directory.`);}catch{this.notify('Unable to delete client.',true);}}
  total(order:Pick<CakeOrder,'amount'|'deliveryAmount'>):number{return order.amount+order.deliveryAmount;}
  balance(order:Pick<CakeOrder,'amount'|'deliveryAmount'|'advancePaid'>):number{return Math.max(0,this.total(order)-order.advancePaid);}
  orderSize(order:Pick<CakeOrder,'cakeType'|'cakeWeight'|'quantity'>):string{return order.cakeType==='Cupcake'||order.cakeType==='Brownie'?`${order.quantity} piece${order.quantity===1?'':'s'}`:order.cakeWeight;}
  currency(value:number):string{return new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:0}).format(value);}
  formatDate(value:string):string{return new Intl.DateTimeFormat('en-IN',{day:'numeric',month:'short',year:'numeric'}).format(new Date(`${value}T00:00:00`));}
  initials(name:string):string{return name.split(' ').map(part=>part[0]).join('').slice(0,2).toUpperCase();}
  private notify(message:string,error=false):void{this.toast.set(`${error?'error':'success'}:${message}`);setTimeout(()=>this.toast.set(''),3000);}
}
