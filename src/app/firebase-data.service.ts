import { Injectable, computed, signal } from '@angular/core';
import { FirebaseApp, getApp, getApps, initializeApp } from 'firebase/app';
import { firebaseConfig, hasFirebaseConfig } from '../environments/firebase.config';
import { Auth, GoogleAuthProvider, User, getAuth, onAuthStateChanged, signInWithPopup, signInWithRedirect, getRedirectResult, signOut } from 'firebase/auth';
import {
  Firestore,
  addDoc,
  collection,
  deleteDoc,
  doc,
  getFirestore,
  onSnapshot,
  runTransaction,
  setDoc,
  updateDoc,
  Transaction,
} from 'firebase/firestore';

export type ExpenseType = 'cake' | 'home';
export type OrderStatus = 'Confirmed' | 'In progress' | 'Ready' | 'Delivered' | 'Closed';
export interface OrderPayment { id: string; amount: number; date: string; type: 'Advance' | 'Delivery' | 'Other' | 'Correction'; }

export interface Expense {
  id: string; name: string; amount: number; date: string; paymentMode: string; paidBy: string; type: ExpenseType; tripId?: string;
}
export interface DeliveryExpenseInput { amount: number; date: string; paymentMode: string; paidBy: string; }
export interface Trip { id: string; name: string; destination: string; startDate: string; endDate: string; notes: string; }

export interface CakeOrder {
  id: string; customer: string; phone: string; address: string; occasion: string;
  location: 'Inside complex' | 'Outside complex'; residentReferral: boolean;
  flavour: string; cakeType: string; setup: 'Delivery' | 'Cake setup' | 'Self pickup'; deliveredBy: string;
  quantity: number; cakeWeight: string; cakeMessage: string; amount: number; advancePaid: number; payments?: OrderPayment[];
  deliveryAmount: number; deliveryMethod: 'Cab' | 'Delivery man' | 'Porter'; deliveryFeeType: 'Free' | 'Paid'; deliveryBookedBy: 'Client' | 'Us'; deliveryCost: number; extraExpenses: number; deliveryExpense?: number; deliveryExpenseSynced?: boolean; dueDate: string; status: OrderStatus;
}

export interface ClientHistory {
  key: string; profileId?: string; name: string; phone: string; address: string; location: 'Inside complex' | 'Outside complex'; residentReferral: boolean; orderCount: number;
  lifetimeValue: number; lastOrderDate: string; orders: CakeOrder[];
}

export interface ClientProfile {
  id: string; name: string; phone: string; address: string; location: 'Inside complex' | 'Outside complex'; residentReferral: boolean; hidden: boolean;
}

export interface MessageTemplate {
  id: string; title: string; category: string; message: string;
}

const APPROVED_FAMILY_EMAILS = new Set(['manmohan531993@gmail.com', 'sonamagarwal463@gmail.com']);

const DEFAULT_FREQUENT_EXPENSES: Record<ExpenseType, string[]> = {
  cake: ['Cake boxes', 'Chocolate compound', 'Flour & sugar', 'Fresh cream', 'Fresh fruit'],
  home: ['Electricity bill', 'Gas cylinder', 'Groceries', 'Internet bill', 'Milk'],
};

@Injectable({ providedIn: 'root' })
export class FirebaseDataService {
  readonly expenses = signal<Expense[]>([]);
  readonly trips = signal<Trip[]>([]);
  readonly tripExpenses = signal<Expense[]>([]);
  readonly allExpenses = computed(() => [...this.expenses(), ...this.tripExpenses()]);
  readonly orders = signal<CakeOrder[]>([]);
  readonly frequentExpenses = signal<Record<ExpenseType, string[]>>(DEFAULT_FREQUENT_EXPENSES);
  readonly messageTemplates = signal<MessageTemplate[]>([]);
  readonly clientProfiles = signal<ClientProfile[]>([]);
  readonly loading = signal(true);
  readonly backendError = signal('');
  readonly user = signal<User | null>(null);
  readonly authReady = signal(false);
  readonly signingIn = signal(false);
  readonly operationLoading = signal(false);
  readonly loadingMessage = signal('Saving…');

  readonly totalSpent = computed(() => this.allExpenses().filter(item => this.isCurrentMonth(item.date)).reduce((sum, item) => sum + item.amount, 0));
  readonly cakeSpent = computed(() => this.expenses().filter(item => item.type === 'cake' && this.isCurrentMonth(item.date)).reduce((sum, item) => sum + item.amount, 0));
  readonly homeSpent = computed(() => this.allExpenses().filter(item => item.type === 'home' && this.isCurrentMonth(item.date)).reduce((sum, item) => sum + item.amount, 0));
  readonly pendingOrders = computed(() => this.orders().filter(item => item.status !== 'Closed').length);
  readonly orderRevenue = computed(() => this.orders().reduce((sum, item) => sum + item.amount, 0));
  readonly advanceCollected = computed(() => this.orders().reduce((sum, item) => sum + item.advancePaid, 0));
  readonly balanceDue = computed(() => this.orders().reduce((sum, item) => sum + Math.max(0, item.amount + item.deliveryAmount - item.advancePaid), 0));
  readonly personSpend = computed(() => ['Manmohan', 'Sonam', 'Nadani', 'Gopal'].map(name => ({
    name,
    total: this.allExpenses().filter(item => item.paidBy === name && this.isCurrentMonth(item.date)).reduce((sum, item) => sum + item.amount, 0),
  })));
  readonly clients = computed<ClientHistory[]>(() => {
    const grouped = new Map<string, ClientHistory>();
    const hiddenKeys = new Set(this.clientProfiles().filter(profile => profile.hidden).map(profile => this.clientKey(profile.name, profile.phone)));
    for (const profile of this.clientProfiles().filter(profile => !profile.hidden)) {
      const key = this.clientKey(profile.name, profile.phone);
      grouped.set(key, { key, profileId: profile.id, name: profile.name.trim(), phone: profile.phone.trim(), address: profile.address.trim(), location:profile.location??'Outside complex', residentReferral:profile.residentReferral??false, orderCount: 0, lifetimeValue: 0, lastOrderDate: '', orders: [] });
    }
    const orders = [...this.orders()].sort((a, b) => b.dueDate.localeCompare(a.dueDate));
    for (const order of orders) {
      const key = this.clientKey(order.customer, order.phone);
      if (hiddenKeys.has(key)) continue;
      const client = grouped.get(key) ?? {
        key, name: order.customer.trim(), phone: order.phone.trim(), address: order.address.trim(), location:order.location??'Outside complex', residentReferral:order.residentReferral??false,
        orderCount: 0, lifetimeValue: 0, lastOrderDate: order.dueDate, orders: [],
      };
      client.orderCount += 1;
      client.lifetimeValue += order.amount + order.deliveryAmount;
      client.orders.push(order);
      if (!client.address && order.address.trim()) client.address = order.address.trim();
      grouped.set(key, client);
    }
    return [...grouped.values()].sort((a, b) => b.lastOrderDate.localeCompare(a.lastOrderDate) || a.name.localeCompare(b.name));
  });

  private db?: Firestore;
  private dbPromise?: Promise<Firestore>;
  private appPromise?: Promise<FirebaseApp>;
  private auth?: Auth;
  private readonly unsubscribeListeners: Array<() => void> = [];
  private readonly loadedCollections = new Set<string>();

  constructor() { void this.initializeAuth(); }

  async signInWithGoogle(): Promise<boolean> {
    this.signingIn.set(true); this.backendError.set('');
    try {
      const auth = this.auth ?? getAuth(await this.getFirebaseApp());
      const credential = await signInWithPopup(auth, new GoogleAuthProvider());
      if (!this.isApprovedFamilyMember(credential.user)) {
        await signOut(auth);
        this.backendError.set('This Google account is not on the approved family access list. Sign in with Manmohan or Sonam’s approved account.');
        return false;
      }
      this.user.set(credential.user); return true;
    } catch (error) {
      const code = (error as { code?: string }).code ?? '';
      if (code === 'auth/popup-blocked' || code === 'auth/cancelled-popup-request') {
        try { const auth=this.auth ?? getAuth(await this.getFirebaseApp()); await signInWithRedirect(auth,new GoogleAuthProvider()); return true; }
        catch (redirectError) { this.backendError.set(this.authErrorMessage(redirectError)); return false; }
      }
      this.backendError.set(this.authErrorMessage(error)); return false;
    } finally { this.signingIn.set(false); }
  }
  async signOutUser(): Promise<void> { if (this.auth) await signOut(this.auth); }

  async addExpense(expense: Omit<Expense, 'id'>): Promise<void> {
    await this.runOperation('Saving expense…', async () => { const db = await this.getDb(); await addDoc(collection(db, 'expenses'), expense); });
  }
  async updateExpense(expense: Expense): Promise<void> {
    await this.runOperation('Updating expense…', async () => { const db = await this.getDb(); const { id, ...data } = expense; await setDoc(doc(db, 'expenses', id), data); });
  }
  async deleteExpense(id: string): Promise<void> { await this.runOperation('Removing expense…', async () => { const db = await this.getDb(); await deleteDoc(doc(db, 'expenses', id)); }); }
  async addTrip(trip: Omit<Trip,'id'>): Promise<void> { await this.runOperation('Saving trip…', async()=>{const db=await this.getDb();await addDoc(collection(db,'trips'),trip);}); }
  async updateTrip(trip: Trip): Promise<void> { await this.runOperation('Updating trip…',async()=>{const db=await this.getDb();const {id,...data}=trip;await setDoc(doc(db,'trips',id),data);}); }
  async deleteTrip(id: string): Promise<void> { await this.runOperation('Deleting trip…',async()=>{const db=await this.getDb();for(const expense of this.tripExpenses().filter(item=>item.tripId===id))await deleteDoc(doc(db,'tripExpenses',expense.id));await deleteDoc(doc(db,'trips',id));}); }
  async addTripExpense(expense: Omit<Expense,'id'>): Promise<void> { await this.runOperation('Saving trip expense…',async()=>{const db=await this.getDb();await addDoc(collection(db,'tripExpenses'),expense);}); }
  async updateTripExpense(expense: Expense): Promise<void> { await this.runOperation('Updating trip expense…',async()=>{const db=await this.getDb();const {id,...data}=expense;await setDoc(doc(db,'tripExpenses',id),data);}); }
  async deleteTripExpense(id: string): Promise<void> { await this.runOperation('Deleting trip expense…',async()=>{const db=await this.getDb();await deleteDoc(doc(db,'tripExpenses',id));}); }

  async addFrequentExpense(type: ExpenseType, name: string): Promise<boolean> {
    const cleanName = name.trim();
    if (!cleanName || this.frequentExpenses()[type].some(item => item.toLowerCase() === cleanName.toLowerCase())) return false;
    const next = { ...this.frequentExpenses(), [type]: [...this.frequentExpenses()[type], cleanName].sort((a, b) => a.localeCompare(b)) };
    await this.runOperation('Saving frequent expense…', async () => { const db = await this.getDb(); await setDoc(doc(db, 'settings', 'frequent-expenses'), next); }); return true;
  }
  async deleteFrequentExpense(type: ExpenseType, name: string): Promise<void> {
    const next = { ...this.frequentExpenses(), [type]: this.frequentExpenses()[type].filter(item => item !== name) };
    await this.runOperation('Updating frequent expenses…', async () => { const db = await this.getDb(); await setDoc(doc(db, 'settings', 'frequent-expenses'), next); });
  }

  async addMessageTemplate(template: Omit<MessageTemplate, 'id'>): Promise<void> { await this.runOperation('Saving message template…', async () => { const db=await this.getDb(); await addDoc(collection(db,'messageTemplates'),template); }); }
  async deleteMessageTemplate(id:string): Promise<void> { await this.runOperation('Deleting message template…', async () => { const db=await this.getDb(); await deleteDoc(doc(db,'messageTemplates',id)); }); }

  async addClient(client: Omit<ClientProfile, 'id' | 'hidden'>): Promise<void> {
    await this.runOperation('Saving client…', async () => {
      const db = await this.getDb();
      const hiddenMatch = this.clientProfiles().find(profile => profile.hidden && this.clientKey(profile.name, profile.phone) === this.clientKey(client.name, client.phone));
      const data = { ...client, hidden: false };
      if (hiddenMatch) await setDoc(doc(db, 'clients', hiddenMatch.id), data); else await addDoc(collection(db, 'clients'), data);
    });
  }
  async updateClient(client: Pick<ClientProfile, 'id' | 'name' | 'phone' | 'address' | 'location' | 'residentReferral'>): Promise<void> {
    await this.runOperation('Updating client…', async () => { const db = await this.getDb(); const { id, ...data } = client; await setDoc(doc(db, 'clients', id), { ...data, hidden: false }); });
  }
  async hideClient(client: Pick<ClientHistory, 'profileId' | 'name' | 'phone' | 'address' | 'location' | 'residentReferral'>): Promise<void> {
    await this.runOperation('Removing client…', async () => {
      const db = await this.getDb(); const data = { name: client.name, phone: client.phone, address: client.address, location:client.location, residentReferral:client.residentReferral, hidden: true };
      if (client.profileId) await setDoc(doc(db, 'clients', client.profileId), data); else await addDoc(collection(db, 'clients'), data);
    });
  }

  async addOrder(order: Omit<CakeOrder, 'id'>, expense?: DeliveryExpenseInput): Promise<void> {
    await this.runOperation('Saving order…', async () => {
      const db = await this.getDb(); const orderRef = doc(collection(db, 'orders'));
      await runTransaction(db, async transaction => {
        transaction.set(orderRef, { ...order, deliveryExpenseSynced: true });
        if (order.status === 'Delivered' || order.status === 'Closed') this.syncDeliveryExpense(transaction, db, orderRef.id, order, expense);
      });
    });
  }
  async updateOrder(order: CakeOrder, expense?: DeliveryExpenseInput): Promise<void> {
    await this.runOperation('Updating order…', async () => {
      const db = await this.getDb(); const { id, ...data } = order;
      await runTransaction(db, async transaction => {
        transaction.set(doc(db, 'orders', id), { ...data, deliveryExpenseSynced: true });
        if (order.status === 'Delivered' || order.status === 'Closed') this.syncDeliveryExpense(transaction, db, id, order, expense);
      });
    });
  }
  async deleteOrder(id: string): Promise<void> {
    await this.runOperation('Deleting order…', async () => {
      const db = await this.getDb();
      await runTransaction(db, async transaction => { transaction.delete(doc(db, 'orders', id)); transaction.delete(doc(db, 'expenses', `order-delivery-${id}`)); });
    });
  }
  async updateOrderStatus(id: string, status: OrderStatus, expense?: DeliveryExpenseInput): Promise<OrderStatus> {
    return this.runOperation('Updating order status…', async () => {
      const db = await this.getDb();
      return runTransaction(db, async transaction => {
        const orderRef = doc(db, 'orders', id); const snapshot = await transaction.get(orderRef);
        if (!snapshot.exists()) throw new Error('Order not found.');
        const order = snapshot.data() as CakeOrder;
        if (status === 'Delivered' && order.setup !== 'Self pickup' && !expense) throw new Error('Enter the delivery or setup expense, including zero if there was no cost.');
        const nextStatus: OrderStatus = status === 'Delivered' && Number(order.advancePaid) >= Number(order.amount) + Number(order.deliveryAmount) ? 'Closed' : status;
        if (status === 'Delivered') {
          const amount = order.setup === 'Self pickup' ? 0 : Number(expense!.amount);
          if (!Number.isFinite(amount) || amount < 0) throw new Error('Delivery expense must be zero or more.');
          transaction.update(orderRef, { status: nextStatus, deliveryExpense: amount, deliveryExpenseSynced: true });
          this.syncDeliveryExpense(transaction, db, id, order, order.setup === 'Self pickup' ? undefined : expense);
        } else transaction.update(orderRef, { status: nextStatus });
        return nextStatus;
      });
    });
  }
  private syncDeliveryExpense(transaction: Transaction, db: Firestore, id: string, order: Pick<CakeOrder, 'customer' | 'setup'>, expense?: DeliveryExpenseInput): void {
    const expenseRef = doc(db, 'expenses', `order-delivery-${id}`);
    if (order.setup === 'Self pickup' || !expense || expense.amount === 0) { transaction.delete(expenseRef); return; }
    if (!Number.isFinite(expense.amount) || expense.amount < 0 || !/^\d{4}-\d{2}-\d{2}$/.test(expense.date)
      || !['GPay', 'Cash', 'Debit card', 'Credit card'].includes(expense.paymentMode)
      || !['Manmohan', 'Sonam', 'Nadani', 'Gopal'].includes(expense.paidBy)) throw new Error('Complete the delivery expense details.');
    transaction.set(expenseRef, {
      name: `${order.setup === 'Cake setup' ? 'Cake setup' : 'Delivery'} expense · ${order.customer}`.slice(0, 100),
      amount: expense.amount, date: expense.date, paymentMode: expense.paymentMode, paidBy: expense.paidBy, type: 'cake',
    });
  }
  async recordOrderPayment(id: string, payment: OrderPayment): Promise<void> {
    await this.runOperation('Recording payment…', async () => {
      const db = await this.getDb();
      await runTransaction(db, async transaction => {
        const orderRef = doc(db, 'orders', id);
        const snapshot = await transaction.get(orderRef);
        if (!snapshot.exists()) throw new Error('Order not found.');
        const order = snapshot.data();
        const total = Number(order['amount'] ?? 0) + Number(order['deliveryAmount'] ?? 0);
        const paid = Number(order['advancePaid'] ?? 0);
        if (!Number.isFinite(payment.amount) || payment.amount <= 0 || payment.amount > total - paid) throw new Error('Payment exceeds the balance due.');
        const nextPaid = paid + payment.amount;
        const status: OrderStatus = (order['status'] === 'Delivered' || order['status'] === 'Closed') && nextPaid >= total ? 'Closed' : order['status'];
        transaction.update(orderRef, { advancePaid: nextPaid, payments: [...(Array.isArray(order['payments']) ? order['payments'] : []), payment], status });
      });
    });
  }

  private async initializeAuth(): Promise<void> {
    try {
      this.auth = getAuth(await this.getFirebaseApp());
      try {
        const result = await getRedirectResult(this.auth);
        if (result?.user && !this.isApprovedFamilyMember(result.user)) {
          await signOut(this.auth);
          this.backendError.set('This Google account is not on the approved family access list. Sign in with Manmohan or Sonam’s approved account.');
        }
      } catch (error) { this.backendError.set(this.authErrorMessage(error)); }
      onAuthStateChanged(this.auth, user => {
        const approvedUser=user && this.isApprovedFamilyMember(user)?user:null;
        this.user.set(approvedUser); this.authReady.set(true); this.stopListeners();
        if (approvedUser) { this.loading.set(true); void this.connect(); }
        else if (user) { void signOut(this.auth!); this.loading.set(false); this.backendError.set('This Google account is not on the approved family access list. Sign in with Manmohan or Sonam’s approved account.'); this.expenses.set([]); this.orders.set([]); this.clientProfiles.set([]); }
        else { this.loading.set(false); this.expenses.set([]); this.tripExpenses.set([]); this.trips.set([]); this.orders.set([]); this.clientProfiles.set([]); }
      }, error => { this.authReady.set(true); this.reportError(error); });
    } catch (error) { this.authReady.set(true); this.reportError(error); }
  }

  private async connect(): Promise<void> {
    try {
      this.backendError.set(''); this.loadedCollections.clear();
      const db = await this.getDb();
      this.unsubscribeListeners.push(onSnapshot(collection(db, 'expenses'), snapshot => {
        this.expenses.set(snapshot.docs.map(item => ({ id: item.id, ...item.data() }) as Expense)); this.markLoaded('expenses');
      }, error => this.reportError(error)));
      this.unsubscribeListeners.push(onSnapshot(collection(db,'trips'),snapshot=>{this.trips.set(snapshot.docs.map(item=>({id:item.id,...item.data()}) as Trip));},error=>this.reportError(error)));
      this.unsubscribeListeners.push(onSnapshot(collection(db,'tripExpenses'),snapshot=>{this.tripExpenses.set(snapshot.docs.map(item=>({id:item.id,...item.data()}) as Expense));},error=>this.reportError(error)));
      this.unsubscribeListeners.push(onSnapshot(collection(db, 'orders'), snapshot => {
        this.orders.set(snapshot.docs.map(item => { const data=item.data(); const bookedBy=data['deliveryBookedBy'] ?? (data['deliveryPayment']==='Cab from us'?'Us':'Client'); const cost=Number(data['deliveryCost'] ?? data['deliveryAmount'] ?? 0); const fullyPaid=Number(data['advancePaid'] ?? 0)>=Number(data['amount'] ?? 0)+Number(data['deliveryAmount'] ?? 0); const status=data['status']==='Enquiry'?'Confirmed':data['status']==='Delivered'&&fullyPaid?'Closed':data['status']; return ({ id:item.id, ...data, location:data['location'] ?? 'Outside complex', residentReferral:data['residentReferral'] ?? false, deliveryMethod:data['deliveryMethod'] ?? 'Cab', deliveryFeeType:data['deliveryFeeType'] ?? (cost>0?'Paid':'Free'), deliveryBookedBy:bookedBy, deliveryCost:cost, status }) as CakeOrder; })); this.markLoaded('orders');
      }, error => this.reportError(error)));
      this.unsubscribeListeners.push(onSnapshot(collection(db, 'clients'), snapshot => {
        this.clientProfiles.set(snapshot.docs.map(item => ({ id: item.id, ...item.data() }) as ClientProfile));
      }, error => this.reportError(error)));
      this.unsubscribeListeners.push(onSnapshot(doc(db, 'settings', 'frequent-expenses'), snapshot => {
        if (snapshot.exists()) this.frequentExpenses.set(snapshot.data() as Record<ExpenseType, string[]>);
      }, error => this.reportError(error)));
      this.unsubscribeListeners.push(onSnapshot(collection(db,'messageTemplates'), snapshot => {
        this.messageTemplates.set(snapshot.docs.map(item=>({id:item.id,...item.data()}) as MessageTemplate));
      }, error=>this.reportError(error)));
    } catch (error) { this.reportError(error); }
  }

  private getDb(): Promise<Firestore> {
    if (this.db) return Promise.resolve(this.db);
    this.dbPromise ??= this.initializeFirestore();
    return this.dbPromise;
  }

  private async initializeFirestore(): Promise<Firestore> {
    const app = await this.getFirebaseApp();
    this.db = getFirestore(app); return this.db;
  }

  private getFirebaseApp(): Promise<FirebaseApp> {
    this.appPromise ??= this.initializeFirebaseApp(); return this.appPromise;
  }

  private async initializeFirebaseApp(): Promise<FirebaseApp> {
    let config = firebaseConfig;
    if (!hasFirebaseConfig) {
      const response = await fetch('/__/firebase/init.json', { cache: 'no-store' });
      if (!response.ok) throw new Error('Firebase configuration is missing. Add the web-app configuration from Firebase Console.');
      config = await response.json();
    }
    if (!config?.projectId) throw new Error('Firebase project configuration is invalid.');
    return getApps().length ? getApp() : initializeApp(config);
  }

  private stopListeners(): void { while (this.unsubscribeListeners.length) this.unsubscribeListeners.pop()?.(); }
  private async runOperation<T>(message: string, operation: () => Promise<T>): Promise<T> {
    this.loadingMessage.set(message); this.operationLoading.set(true);
    try { return await operation(); } finally { this.operationLoading.set(false); }
  }
  private markLoaded(collectionName: string): void { this.loadedCollections.add(collectionName); if (this.loadedCollections.size >= 2) this.loading.set(false); }
  private reportError(error: unknown): void {
    console.error(error); this.loading.set(false);
    const code=(error as {code?:string})?.code ?? '';
    if(code==='permission-denied') this.backendError.set('Firebase denied access to this data. Confirm you are signed in with an approved family account and that the deployed Firestore rules include this collection.');
    else this.backendError.set(error instanceof Error ? error.message : 'Unable to connect to Firebase.');
  }
  private isApprovedFamilyMember(user: User): boolean { return !!user.email && user.emailVerified && APPROVED_FAMILY_EMAILS.has(user.email.toLocaleLowerCase()); }
  private authErrorMessage(error: unknown): string {
    const code=(error as {code?:string})?.code ?? '';
    if(code==='auth/unauthorized-domain') return 'This website domain is not authorized for Google sign-in. Add mannam-expense.web.app to Firebase Authentication → Settings → Authorized domains.';
    if(code==='auth/operation-not-allowed') return 'Google sign-in is disabled. Enable Google under Firebase Authentication → Sign-in method.';
    if(code==='auth/popup-closed-by-user') return 'The Google sign-in window was closed before sign-in finished.';
    if(code==='auth/network-request-failed') return 'Network error during sign-in. Check your connection and try again.';
    if(code==='auth/too-many-requests') return 'Too many sign-in attempts. Wait a little and try again.';
    if(code==='auth/account-exists-with-different-credential') return 'This email is registered with another sign-in method. Use that account method or contact support.';
    if(error instanceof Error) return error.message;
    return 'Google sign-in failed. Check your connection and Firebase Authentication settings, then try again.';
  }
  private isCurrentMonth(value: string): boolean { const date = new Date(`${value}T00:00:00`); const now = new Date(); return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth(); }
  private clientKey(name: string, phone: string): string { return `${name.trim().toLocaleLowerCase()}|${phone.replace(/\D/g, '')}`; }
}
