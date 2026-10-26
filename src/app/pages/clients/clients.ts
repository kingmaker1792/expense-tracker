import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CakeOrder, FirebaseDataService } from '../../firebase-data.service';

@Component({ selector: 'app-clients', imports: [RouterLink], templateUrl: './clients.html' })
export class Clients {
  readonly data=inject(FirebaseDataService);
  readonly search=signal(''); readonly selectedKey=signal('');
  readonly filteredClients=computed(()=>{const q=this.search().trim().toLocaleLowerCase();return this.data.clients().filter(client=>!q||`${client.name} ${client.phone}`.toLocaleLowerCase().includes(q));});
  readonly selectedClient=computed(()=>this.data.clients().find(client=>client.key===this.selectedKey())??this.filteredClients()[0]??null);
  readonly lifetimeValue=computed(()=>this.data.clients().reduce((sum,client)=>sum+client.lifetimeValue,0));
  updateSearch(event:Event):void{this.search.set((event.target as HTMLInputElement).value);this.selectedKey.set('');}
  select(key:string):void{this.selectedKey.set(key);}
  total(order:Pick<CakeOrder,'amount'|'deliveryAmount'>):number{return order.amount+order.deliveryAmount;}
  balance(order:Pick<CakeOrder,'amount'|'deliveryAmount'|'advancePaid'>):number{return Math.max(0,this.total(order)-order.advancePaid);}
  orderSize(order:Pick<CakeOrder,'cakeType'|'cakeWeight'|'quantity'>):string{return order.cakeType==='Cupcake'||order.cakeType==='Brownie'?`${order.quantity} piece${order.quantity===1?'':'s'}`:order.cakeWeight;}
  currency(value:number):string{return new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:0}).format(value);}
  formatDate(value:string):string{return new Intl.DateTimeFormat('en-IN',{day:'numeric',month:'short',year:'numeric'}).format(new Date(`${value}T00:00:00`));}
  initials(name:string):string{return name.split(' ').map(part=>part[0]).join('').slice(0,2).toUpperCase();}
}
