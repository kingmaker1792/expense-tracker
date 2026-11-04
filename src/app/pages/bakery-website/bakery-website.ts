import { CurrencyPipe } from '@angular/common';
import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { BakeryContentService, BakerySectionItem } from '../../bakery-content.service';
import { BakeryProduct } from '../../bakery-content.model';

type ProductRecord = BakeryProduct & { id: string };
type SectionRecord = BakerySectionItem & { id: string };
type Area = 'menu' | 'products' | 'discount' | 'content';

@Component({ selector: 'app-bakery-website', imports: [FormsModule, RouterLink, CurrencyPipe], templateUrl: './bakery-website.html', styleUrl: './bakery-website.scss' })
export class BakeryWebsite implements OnInit, OnDestroy {
  private readonly api = inject(BakeryContentService);
  area: Area = 'menu'; products: ProductRecord[] = []; sections: SectionRecord[] = [];
  contentFilter = 'All sections';
  generalDiscount = 0; product = this.emptyProduct(); section = this.emptySection();
  editingId = ''; editing = false; preview = false; busy = false; error = ''; notice = '';
  sampleMode = false;
  private localSampleIds = new Set<string>();
  private hiddenSampleIds = new Set<string>();
  selectedFiles: File[] = []; private previewUrls: string[] = [];
  readonly categories = ['Cakes', 'Cupcakes', 'Brownies'] as const;
  readonly occasions = ['Birthday', 'Wedding', 'Anniversary', 'Everyday', 'Kids'];
  get occasionOptions(): string[] { return [...new Set([...this.occasions, ...this.product.occasions])]; }
  readonly kinds = ['Custom creation', 'Custom request', 'Highlight', 'Offer', 'Review', 'About', 'Contact'] as const;
  get visibleSections(): SectionRecord[] { return this.contentFilter === 'All sections' ? this.sections : this.sections.filter(item => item.kind === this.contentFilter); }
  get existingProduct(): ProductRecord | undefined { return this.products.find(item => item.id === this.editingId); }
  get existingSection(): SectionRecord | undefined { return this.sections.find(item => item.id === this.editingId); }
  isSampleItem(id: string): boolean { const item = this.products.find(product => product.id === id) ?? this.sections.find(section => section.id === id); return item?.isSample ?? id.startsWith('sample-'); }
  isLocalSample(id: string): boolean { return this.localSampleIds.has(id); }
  async ngOnInit(): Promise<void> { await this.refresh(); }
  ngOnDestroy(): void { this.clearFiles(); }
  private emptyProduct(): BakeryProduct { return { name: '', description: '', category: 'Cakes', price: 0, minQuantity: 1, maxQuantity: 10, discountPercent: null, discountTiers: [], images: [], flavour: '', type: '', occasions: [] }; }
  private emptySection(): BakerySectionItem { return { kind: 'Custom creation', title: '', description: '', image: '' }; }
  async refresh(): Promise<void> {
    this.busy = true; this.error = '';
    try { const [products, sections, discount, hidden] = await Promise.all([this.api.products(), this.api.sections(), this.api.generalDiscount(), this.api.hiddenSamples()]); this.products = products; this.sections = sections; this.generalDiscount = discount; this.hiddenSampleIds = new Set(hidden); this.sampleMode = false; this.localSampleIds.clear(); }
    catch (error) { this.error = this.errorMessage(error); try { await this.showSamples(); } catch { /* Keep the Firebase error visible. */ } }
    finally { this.busy = false; }
  }
  async showSamples(): Promise<void> {
    const samples = await this.api.samplePreview();
    const productIds = new Set(this.products.map(item => item.id));
    const sectionIds = new Set(this.sections.map(item => item.id));
    const extraProducts = samples.products.filter(item => !productIds.has(item.id) && !this.hiddenSampleIds.has(item.id));
    const extraSections = samples.sections.filter(item => !sectionIds.has(item.id) && !this.hiddenSampleIds.has(item.id));
    extraProducts.forEach(item => this.localSampleIds.add(item.id)); extraSections.forEach(item => this.localSampleIds.add(item.id));
    this.products = [...this.products, ...extraProducts]; this.sections = [...this.sections, ...extraSections];
    if (!productIds.size) this.generalDiscount = 10;
    this.sampleMode = true;
  }
  async importSamples(): Promise<void> {
    if (!window.confirm('Import the sample products, custom creations and highlights? You can edit or delete them afterwards.')) return;
    this.busy = true; this.error = ''; this.notice = '';
    try { const count = await this.api.importSamples(); await this.refresh(); if (!this.error) this.notice = `${count} sample items imported.`; }
    catch (error) { this.error = this.errorMessage(error); }
    finally { this.busy = false; }
  }
  go(area: Area): void { this.area = area; this.editing = false; this.preview = false; this.error = ''; this.notice = ''; this.clearFiles(); }
  newProduct(): void { this.product = this.emptyProduct(); this.editingId = ''; this.editing = true; this.preview = false; this.clearFiles(); }
  editProduct(product: ProductRecord): void { const { id, ...data } = product; this.product = structuredClone(data); this.editingId = id; this.editing = true; this.preview = false; this.clearFiles(); }
  newSection(): void { this.section = this.emptySection(); if (this.contentFilter !== 'All sections') this.section.kind = this.contentFilter; this.editingId = ''; this.editing = true; this.preview = false; this.clearFiles(); }
  editSection(item: SectionRecord): void { const { id, ...data } = item; this.section = structuredClone(data); this.editingId = id; this.editing = true; this.preview = false; this.clearFiles(); }
  selectFiles(event: Event): void {
    this.clearFiles(); this.error = '';
    const files = Array.from((event.target as HTMLInputElement).files ?? []);
    const existingCount = this.area === 'products' ? this.product.images.length : (this.section.images?.length ?? (this.section.image ? 1 : 0));
    if (files.some(file => !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024) || files.length + existingCount > 20) {
      this.error = 'Choose JPEG, PNG or WebP images up to 10 MB each, with at most 20 photos per product.';
      (event.target as HTMLInputElement).value = '';
      return;
    }
    this.selectedFiles = files; this.previewUrls = files.map(file => URL.createObjectURL(file));
  }
  get imagesForPreview(): string[] { return [...(this.area === 'products' ? this.product.images : this.section.images?.length ? this.section.images : this.section.image ? [this.section.image] : []), ...this.previewUrls]; }
  removeImage(index: number): void { this.product.images.splice(index, 1); }
  removeSectionImage(index: number): void {
    const images = this.section.images?.length ? [...this.section.images] : this.section.image ? [this.section.image] : [];
    images.splice(index, 1); this.section.images = images; this.section.image = images[0] ?? '';
  }
  get offerPercent(): number { return this.product.discountPercent ?? this.generalDiscount; }
  get salePrice(): number { return Math.round(this.product.price * (1 - this.offerPercent / 100)); }
  get validProduct(): boolean { return !!this.product.name.trim() && !!this.product.flavour.trim() && !!this.product.type.trim() && this.product.price > 0 && this.product.minQuantity > 0 && this.product.maxQuantity >= this.product.minQuantity && (this.product.discountPercent === null || (this.product.discountPercent >= 0 && this.product.discountPercent <= 100)) && this.product.discountTiers.every(tier => tier.minQuantity > 0 && tier.percent >= 0 && tier.percent <= 100); }
  toggleOccasion(occasion: string, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.product.occasions = checked ? [...new Set([...this.product.occasions, occasion])] : this.product.occasions.filter(value => value !== occasion);
  }
  get validSection(): boolean { return !!this.section.title.trim() && !!this.section.description.trim(); }
  async publish(): Promise<void> {
    this.error = ''; this.busy = true;
    try {
      if (this.area === 'discount') await this.api.saveGeneralDiscount(Number(this.generalDiscount));
      else {
        const urls = await Promise.all(this.selectedFiles.map(file => this.api.uploadImage(file)));
        const id = this.editingId || crypto.randomUUID();
        if (this.area === 'products') await this.api.saveProduct(id, { ...this.product, isSample: false, images: [...this.product.images, ...urls] });
        if (this.area === 'content') {
          const images = [...(this.section.images?.length ? this.section.images : this.section.image ? [this.section.image] : []), ...urls];
          await this.api.saveSection(id, { ...this.section, isSample: false, image: images[0] ?? '', images });
        }
      }
      const showingSamples = this.sampleMode; this.preview = false; this.editing = false; this.clearFiles(); await this.refresh(); if (!this.error) { if (showingSamples) await this.showSamples(); this.notice = 'Saved successfully.'; }
    } catch (error) { this.error = this.errorMessage(error); }
    finally { this.busy = false; }
  }
  async remove(id: string): Promise<void> {
    if (!window.confirm('Delete this item?')) return;
    this.busy = true; this.error = '';
    try { const showingSamples = this.sampleMode; if (id.startsWith('sample-')) await this.api.deleteSample(id, this.area === 'products' ? 'products' : 'content'); else if (this.area === 'products') await this.api.deleteProduct(id); else await this.api.deleteSection(id); await this.refresh(); if (!this.error) { if (showingSamples) await this.showSamples(); this.notice = 'Item deleted.'; } }
    catch (error) { this.error = this.errorMessage(error); }
    finally { this.busy = false; }
  }
  private clearFiles(): void { this.previewUrls.forEach(url => URL.revokeObjectURL(url)); this.previewUrls = []; this.selectedFiles = []; }
  private errorMessage(error: unknown): string { return error instanceof Error ? error.message : 'Could not connect to Firebase.'; }
}
