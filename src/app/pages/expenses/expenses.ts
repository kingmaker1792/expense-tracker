import { Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Expense, ExpenseType, FirebaseDataService } from '../../firebase-data.service';

@Component({ selector: 'app-expenses', imports: [ReactiveFormsModule], templateUrl: './expenses.html' })
export class Expenses {
  private readonly fb = inject(FormBuilder); readonly data = inject(FirebaseDataService);
  readonly expenseType = signal<ExpenseType>('cake'); readonly showForm = signal(false); readonly showFrequentManager = signal(false); readonly frequentName = signal(''); readonly editingId = signal<string|null>(null); readonly toast = signal(''); readonly deleteTarget = signal<{ kind:'expense'; item:Expense }|{ kind:'frequent'; name:string }|null>(null);
  readonly search = signal(''); readonly personFilter = signal('all'); readonly modeFilter = signal('all'); readonly months = signal<1|3|6|12|'all'>(1); readonly selectedMonth = signal('');
  readonly form = this.fb.nonNullable.group({ preset: [''], customName: [''], amount: [null as number | null, [Validators.required, Validators.min(1)]], date: [this.today(), Validators.required], paymentMode: ['GPay', Validators.required], paidBy: ['Sonam', Validators.required] });
  readonly filtered = computed(() => {
    const q = this.search().toLowerCase(); const period=this.months(); const exactMonth=this.selectedMonth(); const now=new Date();
    const start=new Date(now.getFullYear(),now.getMonth()-(period==='all'?12:period)+1,1);
    const end=new Date(now.getFullYear(),now.getMonth()+1,0,23,59,59);
    return this.data.expenses().filter(i => i.type === this.expenseType())
      .filter(i => { if(exactMonth) return i.date.startsWith(exactMonth); const date=new Date(`${i.date}T00:00:00`); return date>=start && date<=end; })
      .filter(i => this.personFilter() === 'all' || i.paidBy === this.personFilter())
      .filter(i => this.modeFilter() === 'all' || i.paymentMode === this.modeFilter())
      .filter(i => !q || i.name.toLowerCase().includes(q)).sort((a,b) => b.date.localeCompare(a.date));
  });
  readonly total = computed(() => this.filtered().reduce((sum, i) => sum + i.amount, 0));
  readonly monthOptions = computed(() => {
    const now=new Date(); const start=this.monthKey(new Date(now.getFullYear(),now.getMonth()-11,1)); const end=this.monthKey(now);
    return [...new Set(this.data.expenses().filter(item=>item.type===this.expenseType()).map(item=>item.date.slice(0,7)).filter(key=>/^\d{4}-\d{2}$/.test(key)&&key>=start&&key<=end))]
      .sort((a,b)=>b.localeCompare(a)).map(value=>({value,label:new Intl.DateTimeFormat('en-IN',{month:'long',year:'numeric'}).format(new Date(`${value}-01T00:00:00`))}));
  });
  readonly rangeLabel = computed(() => { const exact=this.selectedMonth(); if(exact) return new Intl.DateTimeFormat('en-IN',{month:'long',year:'numeric'}).format(new Date(`${exact}-01T00:00:00`)); const period=this.months(); if(period==='all') return 'Last 12 months'; const now=new Date(); const start=new Date(now.getFullYear(),now.getMonth()-period+1,1); const fmt=new Intl.DateTimeFormat('en-IN',{month:'short',year:'numeric'}); return period===1 ? fmt.format(now) : `${fmt.format(start)} – ${fmt.format(now)}`; });
  setType(type: ExpenseType) { this.expenseType.set(type); this.reset(); }
  async save() { const v = this.form.getRawValue(); const name = v.customName.trim() || v.preset; if (this.form.invalid || !name) { this.form.markAllAsTouched(); this.notify('Please complete all required fields.', true); return; } try { const id=this.editingId(); const item={ id:id??'', name, amount:Number(v.amount), date:v.date, paymentMode:v.paymentMode, paidBy:v.paidBy, type:this.expenseType() }; if(id) await this.data.updateExpense(item); else { const {id:_,...newItem}=item; await this.data.addExpense(newItem); } this.notify(id?'Expense updated successfully.':'Expense added successfully.'); this.closeForm(); } catch { this.notify('Unable to save expense. Check Firebase access.', true); } }
  edit(item: Expense) { this.editingId.set(item.id); this.form.reset({preset:'',customName:item.name,amount:item.amount,date:item.date,paymentMode:item.paymentMode,paidBy:item.paidBy}); this.showForm.set(true); window.scrollTo({top:80,behavior:'smooth'}); }
  closeForm() { this.editingId.set(null); this.showForm.set(false); this.form.reset({ preset:'',customName:'',amount:null,date:this.today(),paymentMode:'GPay',paidBy:'Sonam' }); }
  requestRemove(item: Expense) { this.deleteTarget.set({kind:'expense',item}); }
  updateFrequentName(e: Event) { this.frequentName.set((e.target as HTMLInputElement).value); }
  async addFrequent() { try { if (await this.data.addFrequentExpense(this.expenseType(), this.frequentName())) { this.notify('Frequent expense added.'); this.frequentName.set(''); } else this.notify('Enter a unique expense name.', true); } catch { this.notify('Unable to save frequent expense.', true); } }
  requestRemoveFrequent(name: string) { this.deleteTarget.set({kind:'frequent',name}); }
  async confirmRemove() { const target=this.deleteTarget(); if(!target) return; this.deleteTarget.set(null); try { if(target.kind==='expense'){ await this.data.deleteExpense(target.item.id); this.notify(`${target.item.name} removed.`); } else { await this.data.deleteFrequentExpense(this.expenseType(), target.name); this.notify(`${target.name} removed from frequent expenses.`); } } catch { this.notify('Unable to delete this item.', true); } }
  closeFrequentManager() { this.showFrequentManager.set(false); this.frequentName.set(''); }
  reset() { this.search.set(''); this.personFilter.set('all'); this.modeFilter.set('all'); this.months.set(1); this.selectedMonth.set(''); }
  setMonths(value:1|3|6|12|'all') { this.months.set(value); this.selectedMonth.set(''); }
  setExactMonth(event:Event) { this.selectedMonth.set((event.target as HTMLSelectElement).value); }
  input(e: Event) { this.search.set((e.target as HTMLInputElement).value); } person(e: Event) { this.personFilter.set((e.target as HTMLSelectElement).value); } mode(e: Event) { this.modeFilter.set((e.target as HTMLSelectElement).value); }
  currency(v: number) { return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(v); }
  formatDate(v: string) { return new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(`${v}T00:00:00`)); }
  initials(v: string) { return v.split(' ').map(p => p[0]).join('').slice(0,2).toUpperCase(); }
  private today() { return new Date().toISOString().slice(0,10); }
  private monthKey(date:Date) { return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}`; }
  private notify(m: string, error=false) { this.toast.set(`${error?'error':'success'}:${m}`); setTimeout(() => this.toast.set(''), 2600); }
}
