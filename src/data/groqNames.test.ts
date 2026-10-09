import { expect, it } from 'vitest';
import { groqNamesSchema, groqNamesToRecognition } from './groqNames';
it('Groq returns only names for one book or a shelf and rejects extra facts', () => {
  expect(Object.keys(groqNamesSchema(false).properties)).toEqual(['title','authors']);
  const raw = {title:'שם ספר',authors:['שם סופר']};
  const item = groqNamesToRecognition(raw,false).items[0];
  expect(item).toMatchObject({title:raw.title,authors:raw.authors,isbn:null,danacode:null,publisher:null,bbox:null});
  expect(groqNamesToRecognition({items:[raw,raw]},true).items).toHaveLength(2);
  expect(groqNamesToRecognition({title:null,authors:[]},false).items).toEqual([]);
  for(const value of [{...raw,isbn:'9780140328721'}, {...raw,authors:['https://example.com']}, {...raw,title:''}, {title:'x',authors:['x','x']}]) expect(()=>groqNamesToRecognition(value,false)).toThrow();
  expect(()=>groqNamesToRecognition({items:Array(41).fill(raw)},true)).toThrow();
});
