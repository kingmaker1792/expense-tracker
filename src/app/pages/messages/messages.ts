import { Component, computed, inject, signal } from '@angular/core';
import { ClientHistory, FirebaseDataService, MessageTemplate } from '../../firebase-data.service';

type DraftTemplate = Pick<MessageTemplate,'title'|'category'|'message'> & { id:string; ready?:boolean };

const READY_TEMPLATES: DraftTemplate[] = [
  {id:'diwali',ready:true,category:'Festival',title:'Diwali wishes',message:'🪔 Happy Diwali, {name}! May your celebration be filled with light, joy and sweet moments. Warm wishes from The Perfect Cake Bakery. ✨'},
  {id:'holi',ready:true,category:'Festival',title:'Holi wishes',message:'🌈 Happy Holi, {name}! Wishing you a colourful day filled with happiness, laughter and delicious celebrations. — The Perfect Cake Bakery'},
  {id:'eid',ready:true,category:'Festival',title:'Eid wishes',message:'🌙 Eid Mubarak, {name}! May this special occasion bring peace, happiness and beautiful moments to your family. — The Perfect Cake Bakery'},
  {id:'christmas',ready:true,category:'Festival',title:'Christmas wishes',message:'🎄 Merry Christmas, {name}! Wishing you and your family a joyful season filled with love and sweetness. — The Perfect Cake Bakery'},
  {id:'new-year',ready:true,category:'Festival',title:'New Year wishes',message:'✨ Happy New Year, {name}! Thank you for being part of our journey. Wishing you a year full of joyful celebrations. — The Perfect Cake Bakery'},
  {id:'festival-offer',ready:true,category:'Offer',title:'Festival special offer',message:'🎉 Hello {name}! Our festival specials are now open for booking. Enjoy a special offer on selected cakes for a limited time. Reply here to know today’s flavours and availability. — The Perfect Cake Bakery'},
  {id:'returning-client',ready:true,category:'Offer',title:'Returning client offer',message:'💛 Hello {name}! We would love to make your next celebration sweeter. As a returning client, ask us about your special booking offer. — The Perfect Cake Bakery'},
];

@Component({selector:'app-messages',templateUrl:'./messages.html'})
export class Messages {
  readonly data=inject(FirebaseDataService); readonly readyTemplates=READY_TEMPLATES;
  readonly title=signal('Festival special offer'); readonly category=signal('Offer');
  readonly message=signal(READY_TEMPLATES.find(item=>item.id==='festival-offer')!.message);
  readonly clientSearch=signal(''); readonly selectedKeys=signal<string[]>([]); readonly sentKeys=signal<string[]>([]); readonly toast=signal('');
  readonly filteredClients=computed(()=>{const q=this.clientSearch().trim().toLocaleLowerCase();return this.data.clients().filter(client=>!q||`${client.name} ${client.phone}`.toLocaleLowerCase().includes(q));});
  readonly selectedClients=computed(()=>this.data.clients().filter(client=>this.selectedKeys().includes(client.key)));
  readonly preview=computed(()=>this.personalized(this.selectedClients()[0]??null));
  selectTemplate(template:DraftTemplate|MessageTemplate):void{this.title.set(template.title);this.category.set(template.category);this.message.set(template.message);this.sentKeys.set([]);}
  updateTitle(event:Event):void{this.title.set((event.target as HTMLInputElement).value);}
  updateCategory(event:Event):void{this.category.set((event.target as HTMLSelectElement).value);}
  updateMessage(event:Event):void{this.message.set((event.target as HTMLTextAreaElement).value);this.sentKeys.set([]);}
  updateClientSearch(event:Event):void{this.clientSearch.set((event.target as HTMLInputElement).value);}
  insert(text:string):void{this.message.update(value=>`${value}${value.endsWith(' ')||!value?'':' '}${text}`);}
  toggleClient(key:string):void{this.selectedKeys.update(keys=>keys.includes(key)?keys.filter(item=>item!==key):[...keys,key]);this.sentKeys.update(keys=>keys.filter(item=>item!==key));}
  selectVisible():void{const keys=this.filteredClients().map(client=>client.key);const allSelected=keys.length>0&&keys.every(key=>this.selectedKeys().includes(key));this.selectedKeys.update(selected=>allSelected?selected.filter(key=>!keys.includes(key)):[...new Set([...selected,...keys])]);}
  async saveTemplate():Promise<void>{const title=this.title().trim();const message=this.message().trim();if(!title||!message){this.notify('Add a title and message before saving.',true);return;}try{await this.data.addMessageTemplate({title,category:this.category(),message});this.notify('Custom template saved for the family.');}catch{this.notify('Unable to save this template.',true);}}
  async deleteTemplate(id:string):Promise<void>{try{await this.data.deleteMessageTemplate(id);this.notify('Custom template removed.');}catch{this.notify('Unable to remove this template.',true);}}
  async copyMessage():Promise<void>{try{await navigator.clipboard.writeText(this.preview());this.notify('Personalized message copied.');}catch{this.notify('Copy is not available in this browser.',true);}}
  sendWhatsApp(client:ClientHistory):void{const number=this.whatsAppNumber(client.phone);if(!number){this.notify(`Check ${client.name}'s phone number.`,true);return;}window.open(`https://wa.me/${number}?text=${encodeURIComponent(this.personalized(client))}`,'_blank','noopener');this.sentKeys.update(keys=>keys.includes(client.key)?keys:[...keys,client.key]);}
  sendNext():void{const client=this.selectedClients().find(item=>!this.sentKeys().includes(item.key));if(client)this.sendWhatsApp(client);else this.notify(this.selectedClients().length?'All selected chats have been opened.':'Select at least one client.',!this.selectedClients().length);}
  personalized(client:ClientHistory|null):string{return this.message().replaceAll('{name}',client?.name.split(' ')[0]||'Manmohan');}
  private whatsAppNumber(phone:string):string{let digits=phone.replace(/\D/g,'');if(digits.length===10)digits=`91${digits}`;else if(digits.length===11&&digits.startsWith('0'))digits=`91${digits.slice(1)}`;return digits.length>=11&&digits.length<=15?digits:'';}
  private notify(message:string,error=false):void{this.toast.set(`${error?'error':'success'}:${message}`);setTimeout(()=>this.toast.set(''),2800);}
}
