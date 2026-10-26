import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CakeOrder, FirebaseDataService } from '../../firebase-data.service';

@Component({ selector: 'app-dashboard', imports: [RouterLink], templateUrl: './dashboard.html' })
export class Dashboard {
  readonly data = inject(FirebaseDataService);
  readonly todayLabel = new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date()).toUpperCase();
  readonly currentMonthLabel = new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric' }).format(new Date());
  readonly greeting = this.timeGreeting();
  readonly loginName = computed(() => this.data.user()?.displayName?.trim() || this.data.user()?.email?.split('@')[0] || 'Family');
  readonly loginInitials = computed(() => this.initials(this.loginName()));
  readonly selectedContributionMonth = signal('');

  readonly revenueSeries = computed(() => {
    const now = new Date();
    const months = Array.from({ length: 12 }, (_, index) => new Date(now.getFullYear(), now.getMonth() - 11 + index, 1));
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
  readonly revenueMonthsWithData = computed(() => this.revenueSeries().filter(item=>item.total>0));
  readonly currentMonthOrderValue = computed(() => this.revenueSeries().at(-1)?.total ?? 0);
  readonly expenseSeries = computed(() => {
    const now=new Date();
    return Array.from({length:12},(_,index)=>new Date(now.getFullYear(),now.getMonth()-11+index,1)).map(date=>{
      const expenses=this.data.expenses().filter(item=>{const d=new Date(`${item.date}T00:00:00`);return d.getFullYear()===date.getFullYear()&&d.getMonth()===date.getMonth();});
      const cake=expenses.filter(item=>item.type==='cake').reduce((sum,item)=>sum+item.amount,0);
      const home=expenses.filter(item=>item.type==='home').reduce((sum,item)=>sum+item.amount,0);
      return {month:new Intl.DateTimeFormat('en-IN',{month:'short',year:'2-digit'}).format(date),cake,home,total:cake+home};
    });
  });
  readonly maxExpense = computed(() => Math.max(...this.expenseSeries().flatMap(item=>[item.cake,item.home]),1));
  readonly expenseMonthsWithData = computed(() => this.expenseSeries().filter(item=>item.total>0));
  readonly contributionMonthOptions = computed(() => {
    const now=new Date(); const start=this.monthKey(new Date(now.getFullYear(),now.getMonth()-11,1)); const end=this.monthKey(now);
    return [...new Set(this.data.expenses().map(item=>item.date.slice(0,7)).filter(key=>/^\d{4}-\d{2}$/.test(key)&&key>=start&&key<=end))]
      .sort((a,b)=>b.localeCompare(a)).map(value=>({value,label:new Intl.DateTimeFormat('en-IN',{month:'long',year:'numeric'}).format(new Date(`${value}-01T00:00:00`))}));
  });
  readonly effectiveContributionMonth = computed(() => this.selectedContributionMonth() || this.contributionMonthOptions()[0]?.value || this.monthKey(new Date()));
  readonly familyContributions = computed(() => {
    const selected=this.effectiveContributionMonth();
    return ['Manmohan','Sonam','Nadani','Gopal'].map(name=>({name,total:this.data.expenses().filter(item=>item.paidBy===name&&item.date.startsWith(selected)).reduce((sum,item)=>sum+item.amount,0)})).filter(person=>person.total>0);
  });
  readonly contributionTotal = computed(() => this.familyContributions().reduce((sum,person)=>sum+person.total,0));
  readonly profitSeries = computed(() => {
    const now=new Date();
    return this.revenueSeries().map((point,index)=>{
      const date=new Date(now.getFullYear(),now.getMonth()-11+index,1);
      const cakeCost=this.data.expenses().filter(item=>{const d=new Date(`${item.date}T00:00:00`);return item.type==='cake'&&d.getFullYear()===date.getFullYear()&&d.getMonth()===date.getMonth();}).reduce((sum,item)=>sum+item.amount,0);
      const extraCost=this.monthOrders(date).reduce((sum,order)=>sum+order.extraExpenses,0);
      const profit=point.total-cakeCost-extraCost;
      return {...point,cakeCost,extraCost,profit,margin:point.total?Math.round(profit/point.total*100):0};
    });
  });
  readonly currentProfit = computed(() => this.profitSeries().at(-1) ?? {profit:0,margin:0,cakeCost:0,extraCost:0,total:0,month:''});
  readonly profitMonthsWithData = computed(() => this.profitSeries().filter(item=>item.profit!==0));
  readonly upcomingOrders = computed(() => {
    const today = this.localDate(new Date());
    return this.data.orders()
      .filter(order => order.status !== 'Closed' && order.dueDate >= today)
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
      .slice(0, 5);
  });
  readonly topClients = computed(() => {
    const map = new Map<string, { name:string; phone:string; total:number; orders:number; quantity:number }>();
    const now=new Date(); const start=this.monthKey(new Date(now.getFullYear(),now.getMonth()-11,1)); const end=this.monthKey(now);
    for (const order of this.data.orders().filter(item=>item.dueDate.slice(0,7)>=start&&item.dueDate.slice(0,7)<=end)) {
      const key = `${order.customer.trim().toLocaleLowerCase()}\u0000${order.phone.replace(/\D/g,'')}`;
      const item=map.get(key) ?? {name:order.customer,phone:order.phone,total:0,orders:0,quantity:0};
      item.total+=this.orderValue(order); item.orders++; item.quantity+=order.quantity; map.set(key,item);
    }
    return [...map.values()].sort((a,b)=>b.total-a.total).slice(0,5);
  });
  readonly reportingOrderCount = computed(() => { const now=new Date(); const start=this.monthKey(new Date(now.getFullYear(),now.getMonth()-11,1)); const end=this.monthKey(now); return this.data.orders().filter(item=>item.dueDate.slice(0,7)>=start&&item.dueDate.slice(0,7)<=end).length; });

  currency(value: number): string { return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(value); }
  initials(name: string): string { return name.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase(); }
  monthShort(value: string): string { return new Intl.DateTimeFormat('en-IN', { month: 'short' }).format(new Date(`${value}T00:00:00`)).toUpperCase(); }
  setContributionMonth(event:Event): void { this.selectedContributionMonth.set((event.target as HTMLSelectElement).value); }
  contributionShare(value:number): number { return this.contributionTotal() ? Math.round(value/this.contributionTotal()*100) : 0; }
  orderSize(order: Pick<CakeOrder, 'cakeType'|'cakeWeight'|'quantity'>): string { return order.cakeType === 'Cupcake' || order.cakeType === 'Brownie' ? `${order.quantity} piece${order.quantity===1?'':'s'}` : order.cakeWeight; }
  private orderValue(order: Pick<CakeOrder, 'amount'|'deliveryAmount'>): number { return order.amount + order.deliveryAmount; }
  private monthOrders(date: Date): CakeOrder[] { return this.data.orders().filter(order => { const d = new Date(`${order.dueDate}T00:00:00`); return d.getFullYear() === date.getFullYear() && d.getMonth() === date.getMonth(); }); }
  private monthKey(date:Date): string { return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}`; }
  private localDate(date: Date): string { const year=date.getFullYear(); const month=String(date.getMonth()+1).padStart(2,'0'); const day=String(date.getDate()).padStart(2,'0'); return `${year}-${month}-${day}`; }
  private timeGreeting(): string { const hour=new Date().getHours(); return hour<12?'morning':hour<17?'afternoon':'evening'; }
}
