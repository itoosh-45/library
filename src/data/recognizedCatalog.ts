import { comparableISBN,parseISBN,type BookInput } from './books';
import { emptyQuery,type CatalogAdapter } from './catalog';
import type { Candidate } from './metadata';
const normalized=(value:string)=>value.normalize('NFKD').replace(/[\u0591-\u05C7]/g,'').toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
export function matchesRecognizedBook(input:BookInput,candidate:Candidate,uniqueTitle=false) {
  if(input.isbn)return [candidate.fields.isbn13,candidate.fields.isbn10].some(code=>{try{return typeof code==='string'&&comparableISBN(parseISBN(code))===comparableISBN(parseISBN(input.isbn));}catch{return false;}});
  if(!input.title||typeof candidate.fields.title!=='string'||normalized(input.title)!==normalized(candidate.fields.title))return false;
  const authors=candidate.fields.authors;
  if(input.authors.filter(Boolean).length)return Array.isArray(authors)&&input.authors.some(author=>authors.some(name=>normalized(author)===normalized(name)));
  return uniqueTitle&&normalized(input.title).length>=6;
}
export async function findRecognizedCandidate(input:BookInput,adapter:CatalogAdapter,signal:AbortSignal) {
  const query={...emptyQuery,isbn:input.isbn,title:input.isbn?'':input.title.slice(0,300),author:input.isbn?'':input.authors.filter(Boolean).join(' ').slice(0,300)};
  let candidates=await adapter.search(query,signal);
  if(!candidates.length&&query.author)candidates=await adapter.search({...query,author:''},signal);
  const exactTitle=candidates.filter(candidate=>typeof candidate.fields.title==='string'&&normalized(candidate.fields.title)===normalized(input.title));
  for(const candidate of candidates.slice(0,3)) {
    const resolved=adapter.resolve?await adapter.resolve(candidate,signal):candidate;
    const withAuthors={...resolved,fields:{...resolved.fields,...(!resolved.fields.authors&&candidate.fields.authors?{authors:candidate.fields.authors}:{})}};
    if(matchesRecognizedBook(input,withAuthors,exactTitle.length===1))return withAuthors;
  }
  return undefined;
}
