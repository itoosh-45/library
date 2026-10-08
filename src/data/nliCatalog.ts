import { catalogServiceRequest } from './goodreads';
import { CatalogError,validateQuery,type CatalogAdapter } from './catalog';
import { validateCandidate } from './metadata';
export function nliCatalogAdapter(fetcher:typeof fetch=fetch):CatalogAdapter {
 const request=catalogServiceRequest(fetcher,'הספרייה הלאומית');
 return {provider:'nli',async search(input,signal){
  const response=await request('/v1/nli-search',{query:validateQuery(input)},signal);
  if(response.provider!=='nli'||!Array.isArray(response.results)||response.results.length>10)throw new CatalogError('error','תשובת הספרייה הלאומית אינה תקינה.');
  return response.results.map(row=>{const candidate=validateCandidate(row);if(candidate.provider!=='nli')throw new CatalogError('error','מקור התוצאה אינו הספרייה הלאומית.');return candidate;});
 }};
}
