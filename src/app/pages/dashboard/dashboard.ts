import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CakeOrder, FirebaseDataService } from '../../firebase-data.service';

@Component({ selector: 'app-dashboard', imports: [RouterLink], templateUrl: './dashboard.html' })
export class Dashboard {
  readonly data = inject(FirebaseDataService);
  readonly todayLabel = new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date()).toUpperCase();
  readonly currentMonthLabel = new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric' }).format(new Date());

  readonly revenueSeries = computed(() => {
    const now = new Date();
    const months = Array.from({ length: 7 }, (_, index) => new Date(now.getFullYear(), now.getMonth() - 6 + index, 1));
    return months.map((date, index) => {
      const total = this.monthOrders(date).reduce((sum, order) => sum + this.orderValue(order), 0);
      const previous = index > 0 ? this.monthOrders(months[index - 1]).reduce((sum, order) => sum + this.orderValue(order), 0) : 0;
      return {
        month: new Intl.DateTimeFormat('en-IN', { month: 'short', year: '2-digit' }).format(date),
        total,
        growth: previous ? Math.round((total - previous) / previous * 100) : 0,
      };
    });
  });
  readonly maxRevenue = computed(() => Math.max(...this.revenueSeries().map(item => item.total), 1));
  readonly currentMonthOrderValue = computed(() => this.revenueSeries().at(-1)?.total ?? 0);
  readonly expenseSeries = computed(() => {
    const now=new Date();
    return Array.from({length:7},(_,index)=>new Date(now.getFullYear(),now.getMonth()-6+index,1)).map(date=>{
      const expenses=this.data.expenses().filter(item=>{const d=new Date(`${item.date}T00:00:00`);return d.getFullYear()===date.getFullYear()&&d.getMonth()===date.getMonth();});
      const cake=expenses.filter(item=>item.type==='cake').reduce((sum,item)=>sum+item.amount,0);
      const home=expenses.filter(item=>item.type==='home').reduce((sum,item)=>sum+item.amount,0);
      return {month:new Intl.DateTimeFormat('en-IN',{month:'short',year:'2-digit'}).format(date),cake,home,total:cake+home};
    });
  });
  readonly maxExpense = computed(() => Math.max(...this.expenseSeries().flatMap(item=>[item.cake,item.home]),1));
  readonly profitSeries = computed(() => {
    const now=new Date();
    return this.revenueSeries().map((point,index)=>{
      const date=new Date(now.getFullYear(),now.getMonth()-6+index,1);
      const cakeCost=this.data.expenses().filter(item=>{const d=new Date(`${item.date}T00:00:00`);return item.type==='cake'&&d.getFullYear()===date.getFullYear()&&d.getMonth()===date.getMonth();}).reduce((sum,item)=>sum+item.amount,0);
      const extraCost=this.monthOrders(date).reduce((sum,order)=>sum+order.extraExpenses,0);
      const profit=point.total-cakeCost-extraCost;
      return {...point,cakeCost,extraCost,profit,margin:point.total?Math.round(profit/point.total*100):0};
    });
  });
  readonly currentProfit = computed(() => this.profitSeries().at(-1) ?? {profit:0,margin:0,cakeCost:0,extraCost:0,total:0,month:''});
  readonly upcomingOrders = computed(() => {
    const today = this.localDate(new Date());
    return this.data.orders()
      .filter(order => order.status !== 'Closed' && order.dueDate >= today)
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
      .slice(0, 5);
  });
  readonly topClients = computed(() => {
    const map = new Map<string, { name:string; phone:string; total:number; orders:number; quantity:number }>();
    for (const order of this.data.orders()) {
      const key = `${order.customer}\u0000${order.phone}`;
      const item=map.get(key) ?? {name:order.customer,phone:order.phone,total:0,orders:0,quantity:0};
      item.total+=this.orderValue(order); item.orders++; item.quantity+=order.quantity; map.set(key,item);
    }
    return [...map.values()].sort((a,b)=>b.total-a.total).slice(0,5);
  });

  currency(value: number): string { return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(value); }
  initials(name: string): string { return name.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase(); }
  monthShort(value: string): string { return new Intl.DateTimeFormat('en-IN', { month: 'short' }).format(new Date(`${value}T00:00:00`)).toUpperCase(); }
  orderSize(order: Pick<CakeOrder, 'cakeType'|'cakeWeight'|'quantity'>): string { return order.cakeType === 'Cupcake' || order.cakeType === 'Brownie' ? `${order.quantity} piece${order.quantity===1?'':'s'}` : order.cakeWeight; }
  private orderValue(order: Pick<CakeOrder, 'amount'|'deliveryAmount'>): number { return order.amount + order.deliveryAmount; }
  private monthOrders(date: Date): CakeOrder[] { return this.data.orders().filter(order => { const d = new Date(`${order.dueDate}T00:00:00`); return d.getFullYear() === date.getFullYear() && d.getMonth() === date.getMonth(); }); }
  private localDate(date: Date): string { const year=date.getFullYear(); const month=String(date.getMonth()+1).padStart(2,'0'); const day=String(date.getDate()).padStart(2,'0'); return `${year}-${month}-${day}`; }
}
