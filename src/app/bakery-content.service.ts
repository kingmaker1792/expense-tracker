import { Injectable } from '@angular/core';
import { getApp } from 'firebase/app';
import { collection, deleteDoc, doc, getDoc, getDocs, getFirestore, runTransaction, setDoc, writeBatch } from 'firebase/firestore';
import { getDownloadURL, getStorage, ref, uploadBytes } from 'firebase/storage';
import { BakeryProduct } from './bakery-content.model';

export interface BakerySectionItem {
  isSample?: boolean;
  kind: string; title: string; description: string; image: string;
  images?: string[]; occasion?: string; link?: string; action?: string;
  customerName?: string; rating?: number; reviewDate?: string; productId?: string;
  phone?: string; instagram?: string; zomato?: string;
}

/** Access is controlled by Firebase rules; this service uses the existing signed-in app. */
@Injectable({ providedIn: 'root' })
export class BakeryContentService {
  async hiddenSamples(): Promise<string[]> {
    const snapshot = await getDocs(collection(getFirestore(getApp()), 'bakeryHiddenSamples'));
    return snapshot.docs.map(item => item.id);
  }
  async deleteSample(id: string, kind: 'products' | 'content'): Promise<void> {
    const db = getFirestore(getApp());
    const batch = writeBatch(db);
    batch.delete(doc(db, kind === 'products' ? 'bakeryProducts' : 'bakerySections', id));
    batch.set(doc(db, 'bakeryHiddenSamples', id), { hidden: true });
    await batch.commit();
  }
  async samplePreview(): Promise<{ products: Array<BakeryProduct & { id: string }>; sections: Array<BakerySectionItem & { id: string }> }> {
    const response = await fetch('/bakery-sample-content.json');
    if (!response.ok) throw new Error('Unable to load sample content.');
    const samples = await response.json() as { cakes: Array<Record<string, unknown>>; customGallery: Array<Record<string, unknown>>; slides: Array<Record<string, unknown>> };
    const products = samples.cakes.map((cake, index): BakeryProduct & { id: string } => ({
      id: `sample-product-${index + 1}`, name: String(cake['name'] ?? ''), description: String(cake['description'] ?? ''),
      category: (cake['category'] ?? 'Cakes') as BakeryProduct['category'], price: Number(cake['price']),
      minQuantity: Number(cake['minQuantity'] ?? 1), maxQuantity: Number(cake['maxQuantity'] ?? 10),
      discountPercent: typeof cake['discountPercent'] === 'number' ? cake['discountPercent'] : null,
      discountTiers: Array.isArray(cake['discountTiers']) ? cake['discountTiers'] as BakeryProduct['discountTiers'] : [],
      images: Array.isArray(cake['images']) ? cake['images'] as string[] : [String(cake['image'] ?? '')],
      flavour: String(cake['flavor'] ?? ''), type: String(cake['type'] ?? ''), occasions: Array.isArray(cake['occasion']) ? cake['occasion'] as string[] : [],
      badge: String(cake['badge'] ?? ''), collection: String(cake['collection'] ?? ''), size: String(cake['size'] ?? ''),
    }));
    const sections: Array<BakerySectionItem & { id: string }> = [
      ...samples.customGallery.map((item, index) => ({ id: `sample-custom-${index + 1}`, kind: 'Custom creation', title: String(item['title'] ?? ''), description: String(item['description'] ?? ''), image: String(item['image'] ?? ''), images: Array.isArray(item['images']) ? item['images'] as string[] : [String(item['image'] ?? '')], occasion: String(item['occasion'] ?? '') })),
      ...samples.slides.map((item, index) => ({ id: `sample-highlight-${index + 1}`, kind: 'Highlight', title: String(item['title'] ?? ''), description: String(item['detail'] ?? ''), image: String(item['image'] ?? ''), link: String(item['link'] ?? ''), action: String(item['action'] ?? '') })),
      { id: 'sample-about', kind: 'About', title: 'Engineer turned baker.', description: 'Sonam Agarwal founded The Perfect Cake Bakery in 2018. With nine years of baking experience, she creates eggless cakes for celebrations big and small.', image: '' },
      { id: 'sample-offer', kind: 'Offer', title: 'Something sweet is coming.', description: 'Add your offer here.', image: '' },
      { id: 'sample-contact', kind: 'Contact', title: 'Let’s talk cake.', description: 'Available on Zomato', image: '', phone: '919903513996', instagram: 'https://www.instagram.com/' },
      { id: 'sample-custom-request', kind: 'Custom request', title: 'Have a cake in mind?', description: 'Share your date, servings or weight, flavour, design photo and delivery area. Let us know about any allergies.', image: 'https://images.unsplash.com/photo-1571115177098-24ec42ed204d?auto=format&fit=crop&w=1100&q=90' },
    ];
    samples.cakes.forEach((cake, index) => { if (Array.isArray(cake['reviews'])) cake['reviews'].forEach((review: { name?: string; text?: string; date?: string }, i: number) => sections.push({ id: `sample-product-review-${index + 1}-${i + 1}`, kind: 'Review', title: 'Sample review', description: review.text ?? '', image: '', customerName: review.name ?? '', rating: 5, reviewDate: review.date ?? 'Sample review', productId: `sample-product-${index + 1}` })); });
    samples.customGallery.forEach((cake, index) => { if (Array.isArray(cake['reviews'])) cake['reviews'].forEach((review: { name?: string; text?: string }, i: number) => sections.push({ id: `sample-custom-review-${index + 1}-${i + 1}`, kind: 'Review', title: 'Sample review', description: review.text ?? '', image: '', customerName: review.name ?? '', rating: 5, reviewDate: 'Sample review', productId: `sample-custom-${index + 1}` })); });
    return { products, sections };
  }
  async importSamples(): Promise<number> {
    const response = await fetch('/bakery-sample-content.json');
    if (!response.ok) throw new Error('Unable to load sample content.');
    const samples = await response.json() as { cakes: Array<Record<string, unknown>>; customGallery: Array<Record<string, unknown>>; slides: Array<Record<string, unknown>> };
    const db = getFirestore(getApp());
    const records: Array<{ collection: string; id: string; data: Record<string, unknown> }> = [];
    samples.cakes.forEach((cake, index) => records.push({ collection: 'bakeryProducts', id: `sample-product-${index + 1}`, data: {
      name: cake['name'], description: cake['description'], category: cake['category'] ?? 'Cakes', price: cake['price'],
      minQuantity: cake['minQuantity'] ?? 1, maxQuantity: cake['maxQuantity'] ?? 10,
      discountPercent: cake['discountPercent'] ?? null, discountTiers: cake['discountTiers'] ?? (cake['category'] && cake['category'] !== 'Cakes' ? [] : [{ minQuantity: 3, percent: 5 }, { minQuantity: 5, percent: 10 }, { minQuantity: 8, percent: 15 }]),
      images: cake['images'] ?? [cake['image']], flavour: cake['flavor'], type: cake['type'], occasions: cake['occasion'],
      badge: cake['badge'] ?? '', collection: cake['collection'] ?? '', size: cake['size'] ?? '',
    } }));
    samples.customGallery.forEach((item, index) => records.push({ collection: 'bakerySections', id: `sample-custom-${index + 1}`, data: {
      kind: 'Custom creation', title: item['title'], description: item['description'], image: item['image'],
      images: item['images'] ?? [item['image']], occasion: item['occasion'],
    } }));
    samples.cakes.forEach((cake, index) => {
      if (!Array.isArray(cake['reviews'])) return;
      cake['reviews'].forEach((review: { name?: string; text?: string; date?: string }, reviewIndex: number) => records.push({ collection: 'bakerySections', id: `sample-product-review-${index + 1}-${reviewIndex + 1}`, data: { kind: 'Review', title: 'Sample review', description: review.text ?? '', image: '', customerName: review.name ?? '', reviewDate: review.date ?? 'Sample review', rating: 5, productId: `sample-product-${index + 1}` } }));
    });
    samples.customGallery.forEach((cake, index) => {
      if (!Array.isArray(cake['reviews'])) return;
      cake['reviews'].forEach((review: { name?: string; text?: string }, reviewIndex: number) => records.push({ collection: 'bakerySections', id: `sample-custom-review-${index + 1}-${reviewIndex + 1}`, data: { kind: 'Review', title: 'Sample review', description: review.text ?? '', image: '', customerName: review.name ?? '', reviewDate: 'Sample review', rating: 5, productId: `sample-custom-${index + 1}` } }));
    });
    samples.slides.forEach((item, index) => records.push({ collection: 'bakerySections', id: `sample-highlight-${index + 1}`, data: {
      kind: 'Highlight', title: item['title'], description: item['detail'], image: item['image'], images: [item['image']], link: item['link'], action: item['action'],
    } }));
    records.push({ collection: 'bakerySections', id: 'sample-about', data: { kind: 'About', title: 'Engineer turned baker.', description: 'Sonam Agarwal founded The Perfect Cake Bakery in 2018. With nine years of baking experience, she creates eggless cakes for celebrations big and small.', image: '' } });
    records.push({ collection: 'bakerySections', id: 'sample-offer', data: { kind: 'Offer', title: 'Something sweet is coming.', description: 'Add your offer here.', image: '' } });
    records.push({ collection: 'bakerySections', id: 'sample-contact', data: { kind: 'Contact', title: 'Let’s talk cake.', description: 'Available on Zomato', image: '', phone: '919903513996', instagram: 'https://www.instagram.com/', zomato: '' } });
    records.push({ collection: 'bakerySections', id: 'sample-custom-request', data: { kind: 'Custom request', title: 'Have a cake in mind?', description: 'Share your date, servings or weight, flavour, design photo and delivery area. Let us know about any allergies.', image: 'https://images.unsplash.com/photo-1571115177098-24ec42ed204d?auto=format&fit=crop&w=1100&q=90' } });
    return runTransaction(db, async transaction => {
      const marker = doc(db, 'bakerySettings', 'sampleImport');
      if ((await transaction.get(marker)).exists()) throw new Error('Sample content has already been imported.');
      const references = records.map(item => doc(db, item.collection, item.id));
      const discount = doc(db, 'bakerySettings', 'discount');
      const [existing, currentDiscount] = await Promise.all([Promise.all(references.map(reference => transaction.get(reference))), transaction.get(discount)]);
      if (existing.some(item => item.exists())) throw new Error('A sample ID already exists; no content was imported.');
      records.forEach((item, index) => transaction.set(references[index], item.data));
      if (!currentDiscount.exists()) transaction.set(discount, { percent: 10 });
      transaction.set(marker, { imported: true });
      return records.length;
    });
  }
  async sections(): Promise<Array<BakerySectionItem & { id: string }>> {
    const snapshot = await getDocs(collection(getFirestore(getApp()), 'bakerySections'));
    return snapshot.docs.map(item => ({ ...item.data() as BakerySectionItem, id: item.id }));
  }

  async saveSection(id: string, item: BakerySectionItem): Promise<void> {
    await setDoc(doc(getFirestore(getApp()), 'bakerySections', id), item);
  }

  async deleteSection(id: string): Promise<void> {
    await deleteDoc(doc(getFirestore(getApp()), 'bakerySections', id));
  }
  async products(): Promise<Array<BakeryProduct & { id: string }>> {
    const snapshot = await getDocs(collection(getFirestore(getApp()), 'bakeryProducts'));
    return snapshot.docs.map(item => ({ ...item.data() as BakeryProduct, id: item.id }));
  }

  async saveProduct(id: string, product: BakeryProduct): Promise<void> {
    await setDoc(doc(getFirestore(getApp()), 'bakeryProducts', id), product);
  }

  async deleteProduct(id: string): Promise<void> {
    await deleteDoc(doc(getFirestore(getApp()), 'bakeryProducts', id));
  }

  async generalDiscount(): Promise<number> {
    const snapshot = await getDoc(doc(getFirestore(getApp()), 'bakerySettings', 'discount'));
    return snapshot.exists() ? Number(snapshot.data()['percent'] ?? 0) : 0;
  }

  async saveGeneralDiscount(percent: number): Promise<void> {
    await setDoc(doc(getFirestore(getApp()), 'bakerySettings', 'discount'), { percent });
  }

  async uploadImage(file: File): Promise<string> {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024) {
      throw new Error('Choose a JPEG, PNG or WebP image up to 10 MB.');
    }
    const image = ref(getStorage(getApp()), `bakery/${crypto.randomUUID()}`);
    await uploadBytes(image, file, { contentType: file.type });
    return getDownloadURL(image);
  }
}
