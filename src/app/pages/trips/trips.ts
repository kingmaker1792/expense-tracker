import { Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Expense, FirebaseDataService, Trip } from '../../firebase-data.service';

@Component({selector:'app-trips',imports:[ReactiveFormsModule],templateUrl:'./trips.html',styleUrl:'./trips.scss'})
export class Trips {
  readonly data=inject(FirebaseDataService); private readonly fb=inject(FormBuilder);
  readonly selectedId=signal(''); readonly tripEditor=signal(false); readonly expenseEditor=signal(false);
  readonly editingTrip=signal<string|null>(null); readonly editingExpense=signal<string|null>(null);
  readonly deleteTarget=signal<{kind:'trip';item:Trip}|{kind:'expense';item:Expense}|null>(null); readonly toast=signal('');
  readonly tripForm=this.fb.nonNullable.group({name:['',Validators.required],destination:[''],startDate:[this.today(),Validators.required],endDate:[this.today(),Validators.required],notes:['']});
  readonly expenseForm=this.fb.nonNullable.group({name:['',Validators.required],amount:[null as number|null,[Validators.required,Validators.min(1)]],date:[this.today(),Validators.required],paymentMode:['GPay'],paidBy:['Sonam']});
  readonly trips=computed(()=>[...this.data.trips()].sort((a,b)=>b.startDate.localeCompare(a.startDate)));
  readonly selected=computed(()=>this.trips().find(t=>t.id===this.selectedId())??this.trips()[0]??null);
  readonly selectedExpenses=computed(()=>this.data.tripExpenses().filter(e=>e.tripId===this.selected()?.id).sort((a,b)=>b.date.localeCompare(a.date)));
  readonly total=computed(()=>this.data.tripExpenses().reduce((sum,e)=>sum+e.amount,0));
  readonly selectedTotal=computed(()=>this.selectedExpenses().reduce((sum,e)=>sum+e.amount,0));
  readonly paidBy=computed(()=>['Manmohan','Sonam','Nadani','Gopal'].map(name=>({name,total:this.selectedExpenses().filter(e=>e.paidBy===name).reduce((sum,e)=>sum+e.amount,0)})).filter(item=>item.total));
  tripTotal(id:string):number{return this.data.tripExpenses().filter(e=>e.tripId===id).reduce((sum,e)=>sum+e.amount,0);}
  tripCount(id:string):number{return this.data.tripExpenses().filter(e=>e.tripId===id).length;}
  openTrip(trip?:Trip):void{this.editingTrip.set(trip?.id??null);this.tripForm.reset(trip?{name:trip.name,destination:trip.destination,startDate:trip.startDate,endDate:trip.endDate,notes:trip.notes}:{name:'',destination:'',startDate:this.today(),endDate:this.today(),notes:''});this.tripEditor.set(true);}
  async saveTrip():Promise<void>{const v=this.tripForm.getRawValue();if(this.tripForm.invalid||v.endDate<v.startDate){this.notify('Enter a trip name and valid dates.',true);return;}try{const id=this.editingTrip();if(id)await this.data.updateTrip({id,...v});else await this.data.addTrip(v);this.tripEditor.set(false);this.notify(id?'Trip updated.':'Trip created.');}catch{this.notify('Unable to save trip.',true);}}
  openExpense(item?:Expense):void{this.editingExpense.set(item?.id??null);this.expenseForm.reset(item?{name:item.name,amount:item.amount,date:item.date,paymentMode:item.paymentMode,paidBy:item.paidBy}:{name:'',amount:null,date:this.today(),paymentMode:'GPay',paidBy:'Sonam'});this.expenseEditor.set(true);}
  async saveExpense():Promise<void>{const trip=this.selected();const v=this.expenseForm.getRawValue();if(!trip||this.expenseForm.invalid){this.notify('Enter an expense name and amount.',true);return;}try{const id=this.editingExpense();const expense={...v,name:v.name.trim(),amount:Number(v.amount),type:'home' as const,tripId:trip.id};if(id)await this.data.updateTripExpense({id,...expense});else await this.data.addTripExpense(expense);this.expenseEditor.set(false);this.notify(id?'Trip expense updated.':'Trip expense added.');}catch{this.notify('Unable to save trip expense.',true);}}
  async confirmDelete():Promise<void>{const target=this.deleteTarget();if(!target)return;try{if(target.kind==='trip')await this.data.deleteTrip(target.item.id);else await this.data.deleteTripExpense(target.item.id);this.deleteTarget.set(null);this.notify('Deleted successfully.');}catch{this.notify('Unable to delete. Please try again.',true);}}
  currency(value:number):string{return new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:0}).format(value);}
  formatDate(value:string):string{return new Intl.DateTimeFormat('en-IN',{day:'numeric',month:'short',year:'numeric'}).format(new Date(`${value}T00:00:00`));}
  private today():string{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
  private notify(message:string,error=false):void{this.toast.set(`${error?'error':'success'}:${message}`);setTimeout(()=>this.toast.set(''),3500);}
}
