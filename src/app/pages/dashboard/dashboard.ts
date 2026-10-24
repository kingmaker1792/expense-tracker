import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FirebaseDataService } from '../../firebase-data.service';

@Component({ selector: 'app-dashboard', imports: [RouterLink], templateUrl: './dashboard.html' })
export class Dashboard {
  readonly data = inject(FirebaseDataService);
  readonly revenueSeries = computed(() => {
    const now = new Date();
    const months = Array.from({ length: 7 }, (_, index) => new Date(now.getFullYear(), now.getMonth() - 6 + index, 1));
    return months.map((date, index) => {
      const total = this.data.orders().filter(order => { const d = new Date(`${order.dueDate}T00:00:00`); return d.getFullYear() === date.getFullYear() && d.getMonth() === date.getMonth(); }).reduce((sum, order) => sum + order.amount, 0);
      const previousDate = index > 0 ? months[index - 1] : null;
      const previous = previousDate ? this.data.orders().filter(order => { const d = new Date(`${order.dueDate}T00:00:00`); return d.getFullYear() === previousDate.getFullYear() && d.getMonth() === previousDate.getMonth(); }).reduce((sum, order) => sum + order.amount, 0) : 0;
      return { month: new Intl.DateTimeFormat('en-IN', { month: 'short' }).format(date), total, growth: previous ? Math.round((total - previous) / previous * 100) : 0 };
    });
  });
  readonly maxRevenue = computed(() => Math.max(...this.revenueSeries().map(item => item.total), 1));
  readonly profitSeries = computed(() => {
    const now=new Date();
    return this.revenueSeries().map((point,index)=>{
      const date=new Date(now.getFullYear(),now.getMonth()-6+index,1);
      const cakeCost=this.data.expenses().filter(item=>{const d=new Date(`${item.date}T00:00:00`);return item.type==='cake'&&d.getFullYear()===date.getFullYear()&&d.getMonth()===date.getMonth();}).reduce((sum,item)=>sum+item.amount,0);
      const extraCost=this.data.orders().filter(order=>{const d=new Date(`${order.dueDate}T00:00:00`);return d.getFullYear()===date.getFullYear()&&d.getMonth()===date.getMonth();}).reduce((sum,order)=>sum+order.extraExpenses,0);
      const profit=point.total-cakeCost-extraCost;
      return {...point,cakeCost,extraCost,profit,margin:point.total?Math.round(profit/point.total*100):0};
    });
  });
  readonly currentProfit = computed(() => this.profitSeries().at(-1) ?? {profit:0,margin:0,cakeCost:0,extraCost:0,total:0,month:''});
  readonly topClients = computed(() => {
    const map = new Map<string, { name:string; total:number; orders:number; quantity:number }>();
    for (const order of this.data.orders()) { const item=map.get(order.customer) ?? {name:order.customer,total:0,orders:0,quantity:0}; item.total+=order.amount; item.orders++; item.quantity+=order.quantity; map.set(order.customer,item); }
    return [...map.values()].sort((a,b)=>b.total-a.total).slice(0,5);
  });
  currency(value: number): string { return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(value); }
  initials(name: string): string { return name.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase(); }
}
