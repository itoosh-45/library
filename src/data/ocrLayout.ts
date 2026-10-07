import { parseISBN } from './books';
import { validateShelfRecognition, type RecognizedBook, type RecognitionResult } from './recognition';
export interface OcrLine { text: string; confidence: number; bbox: { x0:number;y0:number;x1:number;y1:number } }
const letters=(text:string)=>(text.match(/[\p{L}]/gu)??[]).length;
const clean=(text:string)=>text.replace(/\s+/g,' ').trim();
const height=(line:OcrLine)=>line.bbox.y1-line.bbox.y0;
const publisher=(text:string)=>/(?:הוצא[הת]|(?:publishing|publisher|press)\b)/i.test(text);
function isbnFrom(text:string):string|null {
  for(const match of text.matchAll(/(?:97[89][\d\s-]{10,20}\d|\d[\d\s-]{7,17}[\dX])/gi)) {
    try{const value=parseISBN(match[0]);if(value.isbn13||value.isbn10)return value.isbn13??value.isbn10;}catch{/* OCR digits must pass ISBN checksum. */}
  }return null;
}
function adjacent(a:OcrLine,b:OcrLine) {
  const overlapY=Math.min(a.bbox.y1,b.bbox.y1)-Math.max(a.bbox.y0,b.bbox.y0);
  const overlapX=Math.min(a.bbox.x1,b.bbox.x1)-Math.max(a.bbox.x0,b.bbox.x0);
  const xGap=Math.max(a.bbox.x0,b.bbox.x0)-Math.min(a.bbox.x1,b.bbox.x1);
  const yGap=Math.max(a.bbox.y0,b.bbox.y0)-Math.min(a.bbox.y1,b.bbox.y1);
  return overlapY>Math.min(height(a),height(b))*.4&&xGap<Math.min(height(a),height(b))*.35 || overlapX>Math.min(a.bbox.x1-a.bbox.x0,b.bbox.x1-b.bbox.x0)*.45&&yGap<Math.max(height(a),height(b))*1.8;
}
export function booksFromOcr(lines:OcrLine[],width:number,imageHeight:number,mode:'single'|'shelf'='shelf'):RecognitionResult {
  if(!Number.isFinite(width)||!Number.isFinite(imageHeight)||width<=0||imageHeight<=0)return {items:[]};
  const accepted=lines.slice(0,2000).map(line=>({...line,text:clean(line.text)})).filter(line=>line.confidence>=45&&line.text.length<=1000&&(letters(line.text)>=2||isbnFrom(line.text))&&Object.values(line.bbox).every(Number.isFinite)&&line.bbox.x0>=0&&line.bbox.y0>=0&&line.bbox.x1>line.bbox.x0&&line.bbox.y1>line.bbox.y0&&line.bbox.x1<=width&&line.bbox.y1<=imageHeight);
  const groups:OcrLine[][]=[];
  if (mode === 'single') {
    const hebrew = accepted.filter(line => /[א-ת]/.test(line.text));
    if (hebrew.length) groups.push(hebrew);
  }
  for(const line of (mode === 'single' ? [] : accepted).sort((a,b)=>a.bbox.y0-b.bbox.y0||b.bbox.x0-a.bbox.x0)) {
    const matches=groups.filter(group=>group.some(other=>adjacent(line,other)));
    if(!matches.length)groups.push([line]);else{matches[0].push(line);for(const other of matches.slice(1)){matches[0].push(...other);groups.splice(groups.indexOf(other),1);}}
  }
  const items:RecognizedBook[]=[];
  for(const group of groups) {
    const visibleText=group.map(line=>line.text).join('\n').slice(0,16000),isbn=isbnFrom(visibleText);
    const candidates=group.filter(line=>letters(line.text)>=2&&!publisher(line.text)&&!/^ISBN\b/i.test(line.text)&&!/^מאת\s/.test(line.text));
    const rank=(line:OcrLine)=>height(line)*(line.confidence/100)*(1+(1-line.bbox.y0/imageHeight)*.12);
    candidates.sort((a,b)=>rank(b)-rank(a));const title=candidates[0];
    if(!title&&!isbn)continue;
    const titleLines = title ? [title] : [];
    if (mode === 'single' && title) {
      for (const line of candidates) if (line !== title && height(line) >= height(title) * .85 && height(line) <= height(title) * 1.15 && Math.abs(line.bbox.y0 - title.bbox.y0) < height(title) * 2 && adjacent(title, line)) titleLines.push(line);
      titleLines.sort((a,b) => a.bbox.y0-b.bbox.y0 || b.bbox.x0-a.bbox.x0);
    }
    let titleText = titleLines.map(line => line.text).join(' ');
    if (!clean(visibleText).includes(titleText)) { titleLines.splice(1); titleText = title?.text ?? ''; }
    const author=group.filter(line=>!titleLines.includes(line)&&!publisher(line.text)&&letters(line.text)>=3&&!isbnFrom(line.text)&&line.text.split(' ').length<=5&&( /^מאת\s|^by\s/i.test(line.text)|| title&&height(line)>=height(title)*.3&&height(line)<=height(title)*.85)).sort((a,b)=>Number(/^מאת\s|^by\s/i.test(b.text))-Number(/^מאת\s|^by\s/i.test(a.text)) || (title?Math.abs(a.bbox.y0-title.bbox.y0)-Math.abs(b.bbox.y0-title.bbox.y0):0))[0];
    const pub=group.find(line=>publisher(line.text));
    const name=author?.text.replace(/^(?:מאת|by)\s+/i,'');
    const bbox:[number,number,number,number]=[Math.min(...group.map(line=>line.bbox.x0))/width,Math.min(...group.map(line=>line.bbox.y0))/imageHeight,Math.max(...group.map(line=>line.bbox.x1))/width,Math.max(...group.map(line=>line.bbox.y1))/imageHeight];
    items.push({title:titleText||null,authors:name?[name]:[],isbn,danacode:null,publisher:pub?.text??null,visibleText,evidenceByField:{title:titleText?[titleText]:[],authors:author?[author.text]:[],isbn:isbn?[visibleText]:[],danacode:[],publisher:pub?[pub.text]:[]},imageIndex:0,bbox,uncertaintyReasons:['OCR מקומי: השם והמחבר הוצעו לפי גודל יחסי ומיקום הטקסט. יש לאמת מול הספר.']});
  }
  return validateShelfRecognition({items:items.slice(0,40)});
}
