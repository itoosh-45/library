import { createWorker, OEM, PSM, type Worker } from 'tesseract.js';
import { booksFromOcr, type OcrLine } from './ocrLayout';
import { recognitionModels } from './recognition';
import { VisionError,type VisionOutcome } from './visionTypes';
export class LocalOcrSession {
  #worker?:Worker;#sequence=0;#owner=0;#reject?: (error:unknown)=>void;
  cancel() {this.#sequence++;this.#reject?.(new VisionError('cancelled','OCR בוטל.'));this.#reject=undefined;void this.#worker?.terminate().catch(()=>{});this.#worker=undefined;}
  async recognize(blob:Blob,mode:'single'|'shelf',progress:(message?:string)=>void):Promise<VisionOutcome> {
    if(this.#reject)throw new VisionError('busy','OCR כבר פועל.');
    const sequence=++this.#sequence;this.#owner=sequence;let workerForJob:Worker|undefined;
    const current=()=>{if(sequence!==this.#sequence)throw new VisionError('cancelled','OCR בוטל.');};
    const stopped=new Promise<never>((_,reject)=>{this.#reject=reject;});
    const timer=setTimeout(()=>{this.#sequence++;this.#reject?.(new VisionError('timeout','OCR ארך יותר מדי. נסה תמונה קרובה של ספר אחד.'));void this.#worker?.terminate().catch(()=>{});},90000);
    const run=async()=>{
      const base=new URL(import.meta.env.BASE_URL+'ocr/',location.origin).href;
      const worker=await createWorker(['heb','eng'],OEM.LSTM_ONLY,{workerPath:base+'worker.min.js',corePath:base+'tesseract-core-lstm.js',langPath:base,workerBlobURL:false,gzip:true,logger:event=>{if(sequence===this.#sequence)progress(event.status==='recognizing text'?`OCR מקומי · ${Math.round(event.progress*100)}%`:'טוען OCR בעברית ובאנגלית…');}});
      if(sequence!==this.#sequence){await worker.terminate();current();}this.#worker=worker;workerForJob=worker;
      await worker.setParameters({tessedit_pageseg_mode:PSM.SPARSE_TEXT});
      const url=URL.createObjectURL(blob),image=new Image();image.src=url;
      try {
        await image.decode();current();let best:VisionOutcome|undefined,bestScore=0;
        for(const rotation of [0,90,270] as const) {
          current();const canvas=document.createElement('canvas'),turn=rotation!==0;canvas.width=turn?image.naturalHeight:image.naturalWidth;canvas.height=turn?image.naturalWidth:image.naturalHeight;
          const ctx=canvas.getContext('2d');if(!ctx)throw new VisionError('invalid','לא ניתן להכין תמונה ל-OCR.');
          ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);if(rotation===90)ctx.translate(canvas.width,0);if(rotation===270)ctx.translate(0,canvas.height);ctx.rotate(rotation*Math.PI/180);ctx.drawImage(image,0,0);
          const {data}=await worker.recognize(canvas,{}, {text:true,blocks:true});current();
          const lines:OcrLine[]=(data.blocks??[]).flatMap(block=>block.paragraphs.flatMap(paragraph=>paragraph.lines.map(line=>({text:line.text,confidence:line.confidence,bbox:line.bbox}))));
          const result=booksFromOcr(lines,canvas.width,canvas.height);
          for(const item of result.items)if(item.bbox&&rotation){const [x0,y0,x1,y1]=item.bbox;item.bbox=rotation===90?[y0,1-x1,y1,1-x0]:[1-y1,x0,1-y0,x1];}
          const score=result.items.reduce((sum,item)=>sum+(item.title?.length??0)+(item.isbn?30:0),0)*(data.confidence/100);
          if(score>bestScore){bestScore=score;best={result:mode==='single'?{items:result.items.slice(0,1)}:result,model:recognitionModels.ocr,usedBackup:false};}
          if(rotation===0&&data.confidence>=75&&result.items.length>0)break;
        }
        return best??{result:{items:[]},model:recognitionModels.ocr,usedBackup:false};
      }finally{URL.revokeObjectURL(url);image.src='';}
    };
    try{return await Promise.race([run(),stopped]);}catch(error){if(error instanceof VisionError)throw error;throw new VisionError('invalid','OCR לא הושלם. נסה תמונה חדה יותר או זיהוי בענן.');}
    finally{clearTimeout(timer);if(this.#owner===sequence){this.#reject=undefined;if(this.#worker===workerForJob)this.#worker=undefined;}await workerForJob?.terminate().catch(()=>{});}
  }
}
export const localOcrSession=new LocalOcrSession();
