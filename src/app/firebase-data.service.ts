import { Injectable, computed, signal } from '@angular/core';
import { FirebaseApp, getApp, getApps, initializeApp } from 'firebase/app';
import { firebaseConfig, hasFirebaseConfig } from '../environments/firebase.config';
import { Auth, GoogleAuthProvider, User, getAuth, onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth';
import {
  Firestore,
  addDoc,
  collection,
  deleteDoc,
  doc,
  getFirestore,
  onSnapshot,
  setDoc,
  updateDoc,
} from 'firebase/firestore';

export type ExpenseType = 'cake' | 'home';
export type OrderStatus = 'Confirmed' | 'In progress' | 'Ready' | 'Delivered' | 'Closed';

export interface Expense {
  id: string; name: string; amount: number; date: string; paymentMode: string; paidBy: string; type: ExpenseType;
}

export interface CakeOrder {
  id: string; customer: string; phone: string; address: string; occasion: string;
  flavour: string; cakeType: string; setup: 'Delivery' | 'Cake setup' | 'Self pickup'; deliveredBy: string;
  quantity: number; cakeWeight: string; cakeMessage: string; amount: number; advancePaid: number;
  deliveryAmount: number; extraExpenses: number; dueDate: string; status: OrderStatus;
}

export interface ClientHistory {
  key: string; name: string; phone: string; address: string; orderCount: number;
  lifetimeValue: number; lastOrderDate: string; orders: CakeOrder[];
}

const DEFAULT_FREQUENT_EXPENSES: Record<ExpenseType, string[]> = {
  cake: ['Cake boxes', 'Chocolate compound', 'Flour & sugar', 'Fresh cream', 'Fresh fruit'],
  home: ['Electricity bill', 'Gas cylinder', 'Groceries', 'Internet bill', 'Milk'],
};

@Injectable({ providedIn: 'root' })
export class FirebaseDataService {
  readonly expenses = signal<Expense[]>([]);
  readonly orders = signal<CakeOrder[]>([]);
  readonly frequentExpenses = signal<Record<ExpenseType, string[]>>(DEFAULT_FREQUENT_EXPENSES);
  readonly loading = signal(true);
  readonly backendError = signal('');
  readonly user = signal<User | null>(null);
  readonly authReady = signal(false);
  readonly signingIn = signal(false);
  readonly operationLoading = signal(false);
  readonly loadingMessage = signal('Saving…');

  readonly totalSpent = computed(() => this.expenses().filter(item => this.isCurrentMonth(item.date)).reduce((sum, item) => sum + item.amount, 0));
  readonly cakeSpent = computed(() => this.expenses().filter(item => item.type === 'cake' && this.isCurrentMonth(item.date)).reduce((sum, item) => sum + item.amount, 0));
  readonly homeSpent = computed(() => this.expenses().filter(item => item.type === 'home' && this.isCurrentMonth(item.date)).reduce((sum, item) => sum + item.amount, 0));
  readonly pendingOrders = computed(() => this.orders().filter(item => item.status !== 'Closed').length);
  readonly orderRevenue = computed(() => this.orders().reduce((sum, item) => sum + item.amount, 0));
  readonly advanceCollected = computed(() => this.orders().reduce((sum, item) => sum + item.advancePaid, 0));
  readonly balanceDue = computed(() => this.orders().reduce((sum, item) => sum + Math.max(0, item.amount + item.deliveryAmount - item.advancePaid), 0));
  readonly personSpend = computed(() => ['Manmohan', 'Sonam', 'Nadani', 'Gopal'].map(name => ({
    name,
    total: this.expenses().filter(item => item.paidBy === name && this.isCurrentMonth(item.date)).reduce((sum, item) => sum + item.amount, 0),
  })));
  readonly clients = computed<ClientHistory[]>(() => {
    const grouped = new Map<string, ClientHistory>();
    const orders = [...this.orders()].sort((a, b) => b.dueDate.localeCompare(a.dueDate));
    for (const order of orders) {
      const key = this.clientKey(order.customer, order.phone);
      const client = grouped.get(key) ?? {
        key, name: order.customer.trim(), phone: order.phone.trim(), address: order.address.trim(),
        orderCount: 0, lifetimeValue: 0, lastOrderDate: order.dueDate, orders: [],
      };
      client.orderCount += 1;
      client.lifetimeValue += order.amount + order.deliveryAmount;
      client.orders.push(order);
      if (!client.address && order.address.trim()) client.address = order.address.trim();
      grouped.set(key, client);
    }
    return [...grouped.values()].sort((a, b) => b.lastOrderDate.localeCompare(a.lastOrderDate));
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
      const credential = await signInWithPopup(auth, new GoogleAuthProvider()); this.user.set(credential.user); return true;
    } catch (error) { this.reportError(error); return false; } finally { this.signingIn.set(false); }
  }
  async signOutUser(): Promise<void> { if (this.auth) await signOut(this.auth); }

  async addExpense(expense: Omit<Expense, 'id'>): Promise<void> {
    await this.runOperation('Saving expense…', async () => { const db = await this.getDb(); await addDoc(collection(db, 'expenses'), expense); });
  }
  async updateExpense(expense: Expense): Promise<void> {
    await this.runOperation('Updating expense…', async () => { const db = await this.getDb(); const { id, ...data } = expense; await setDoc(doc(db, 'expenses', id), data); });
  }
  async deleteExpense(id: string): Promise<void> { await this.runOperation('Removing expense…', async () => { const db = await this.getDb(); await deleteDoc(doc(db, 'expenses', id)); }); }

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

  async addOrder(order: Omit<CakeOrder, 'id'>): Promise<void> { await this.runOperation('Saving order…', async () => { const db = await this.getDb(); await addDoc(collection(db, 'orders'), order); }); }
  async updateOrder(order: CakeOrder): Promise<void> { await this.runOperation('Updating order…', async () => { const db = await this.getDb(); const { id, ...data } = order; await setDoc(doc(db, 'orders', id), data); }); }
  async deleteOrder(id: string): Promise<void> { await this.runOperation('Deleting order…', async () => { const db = await this.getDb(); await deleteDoc(doc(db, 'orders', id)); }); }
  async updateOrderStatus(id: string, status: OrderStatus): Promise<OrderStatus> {
    const order = this.orders().find(item => item.id === id); if (!order) throw new Error('Order not found.');
    const nextStatus: OrderStatus = status === 'Delivered' && order.advancePaid >= order.amount + order.deliveryAmount ? 'Closed' : status;
    await this.runOperation('Updating order status…', async () => { const db = await this.getDb(); await updateDoc(doc(db, 'orders', id), { status: nextStatus }); });
    return nextStatus;
  }
  async markOrderFullyPaid(id: string): Promise<void> {
    const order = this.orders().find(item => item.id === id); if (!order) throw new Error('Order not found.');
    const status: OrderStatus = order.status === 'Delivered' ? 'Closed' : order.status;
    await this.runOperation('Completing payment…', async () => { const db = await this.getDb(); await updateDoc(doc(db, 'orders', id), { advancePaid: order.amount + order.deliveryAmount, status }); });
  }

  private async initializeAuth(): Promise<void> {
    try {
      this.auth = getAuth(await this.getFirebaseApp());
      onAuthStateChanged(this.auth, user => {
        this.user.set(user); this.authReady.set(true); this.stopListeners();
        if (user) { this.loading.set(true); void this.connect(); }
        else { this.loading.set(false); this.expenses.set([]); this.orders.set([]); }
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
      this.unsubscribeListeners.push(onSnapshot(collection(db, 'orders'), snapshot => {
        this.orders.set(snapshot.docs.map(item => ({ id: item.id, ...item.data(), status: item.data()['status'] === 'Enquiry' ? 'Confirmed' : item.data()['status'] }) as CakeOrder)); this.markLoaded('orders');
      }, error => this.reportError(error)));
      this.unsubscribeListeners.push(onSnapshot(doc(db, 'settings', 'frequent-expenses'), snapshot => {
        if (snapshot.exists()) this.frequentExpenses.set(snapshot.data() as Record<ExpenseType, string[]>);
      }, error => this.reportError(error)));
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
  private reportError(error: unknown): void { console.error(error); this.loading.set(false); this.backendError.set(error instanceof Error ? error.message : 'Unable to connect to Firebase.'); }
  private isCurrentMonth(value: string): boolean { const date = new Date(`${value}T00:00:00`); const now = new Date(); return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth(); }
  private clientKey(name: string, phone: string): string { return `${name.trim().toLocaleLowerCase()}|${phone.replace(/\D/g, '')}`; }
}
