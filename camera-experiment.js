(() => {
  'use strict';
  const $=id=>document.getElementById(id),events=[];
  let stream=null,generation=0,photoGeneration=0,activeUrl=null,hasImage=false,decoding=false;
  const reader=new ZXingBrowser.BrowserMultiFormatOneDReader();
  const record=(action,result)=>events.push({action,result,at:new Date().toISOString()});
  function classifyBarcode(input) {
    const raw=String(input).trim(),value=raw.replace(/[\s-]/g,'').toUpperCase();
    if(/^\d{13}$/.test(value)) {
      const sum=[...value.slice(0,12)].reduce((s,d,i)=>s+Number(d)*(i%2?3:1),0);
      if((10-sum%10)%10!==Number(value[12]))return {value,kind:'invalid-checksum'};
      return {value,kind:/^97[89]/.test(value)?'isbn13':'ean13'};
    }
    if(/^\d{9}[\dX]$/.test(value)) {
      const sum=[...value].reduce((s,d,i)=>s+(d==='X'?10:Number(d))*(10-i),0);
      return {value,kind:sum%11===0?'isbn10':'invalid-checksum'};
    }
    return {value:raw,kind:raw?'other':'empty'};
  }
  function showResult(raw) {
    const r=classifyBarcode(raw);const names={isbn13:'ISBN-13 תקין',isbn10:'ISBN-10 תקין',ean13:'ברקוד EAN — אינו ISBN',other:'מספר ברקוד אחר; לא אומת כמזהה ספר','invalid-checksum':'ספרת הביקורת אינה תקינה',empty:'לא הוזן מספר'};
    $('barcode').textContent=names[r.kind]+(r.value?'\n'+r.value:'');record('identifier',r.kind);
  }
  function stop(message='המצלמה כבויה.') {
    generation++;
    if(stream)for(const track of stream.getTracks())track.stop();
    stream=null;$('video').srcObject=null;$('video').hidden=true;$('start').disabled=false;$('stop').disabled=true;$('capture').disabled=true;
    $('status').textContent=message;record('camera','stopped');
  }
  function clearImage() {
    photoGeneration++;if(activeUrl)URL.revokeObjectURL(activeUrl);activeUrl=null;
    hasImage=false;$('image').width=1;$('image').height=1;$('image').hidden=true;$('decode').disabled=true;$('file').value='';$('barcode').textContent='אין תוצאה עדיין.';
  }
  function paint(source,width,height) {
    if(!width||!height)throw Error('image-not-ready');
    const scale=Math.min(1,1600/Math.max(width,height));
    const canvas=$('image');canvas.width=Math.max(1,Math.round(width*scale));canvas.height=Math.max(1,Math.round(height*scale));
    canvas.getContext('2d',{willReadFrequently:true}).drawImage(source,0,0,canvas.width,canvas.height);
    canvas.hidden=false;hasImage=true;$('decode').disabled=false;$('barcode').textContent='אין תוצאה עדיין.';
  }
  $('start').addEventListener('click',async()=>{
    stop();clearImage();const current=++generation;$('start').disabled=true;$('stop').disabled=false;
    if(!isSecureContext||!navigator.mediaDevices?.getUserMedia){stop('הדפדפן דורש כתובת HTTPS כדי לפתוח מצלמה. אפשר לבחור צילום או להקליד מספר.');record('camera','unsupported-context');return;}
    $('status').textContent='ממתין לרשות לפתוח מצלמה…';
    try {
      const acquired=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720}}});
      if(current!==generation){acquired.getTracks().forEach(t=>t.stop());return;}
      stream=acquired;$('video').srcObject=stream;$('video').hidden=false;
      await $('video').play();if(current!==generation)return;
      $('capture').disabled=false;$('status').textContent='המצלמה פתוחה. מקם ברקוד קריא וצלם פריים לבדיקה.';record('camera','started');
      stream.getVideoTracks().forEach(track=>track.addEventListener('ended',()=>{if(current===generation)stop('המצלמה נסגרה על ידי הדפדפן.');},{once:true}));
    }catch(error){if(current!==generation)return;const denied=['NotAllowedError','SecurityError'].includes(error.name);stop(denied?'הרשות למצלמה לא ניתנה. אפשר לבחור צילום או להקליד מספר.':'לא ניתן לפתוח מצלמה. אפשר לבחור צילום או להקליד מספר.');record('camera',denied?'permission-denied':'unavailable');}
  });
  $('stop').addEventListener('click',()=>stop());
  $('capture').addEventListener('click',()=>{try{paint($('video'),$('video').videoWidth,$('video').videoHeight);stop('הפריים מוכן לקריאת ברקוד. המצלמה כובתה.');record('photo','captured');}catch{$('status').textContent='המצלמה עדיין אינה מוכנה לצילום.';}});
  $('file').addEventListener('change',async()=>{
    const file=$('file').files[0];stop();clearImage();if(!file)return;
    if(file.size>15*1024*1024||(!/^image\/(jpeg|png|webp|heic|heif)$/i.test(file.type)&&!(/\.(jpe?g|png|webp|heic|heif)$/i.test(file.name)&&!file.type))){$('status').textContent='בחר תמונת JPEG, PNG, WebP או HEIC עד 15MB.';record('photo','rejected');return;}
    const current=photoGeneration;const url=URL.createObjectURL(file);activeUrl=url;const image=new Image();
    try{image.src=url;await image.decode();if(current!==photoGeneration)return;paint(image,image.naturalWidth,image.naturalHeight);$('status').textContent='הצילום מוכן. לחץ על קריאת ברקוד.';record('photo','loaded');}
    catch{if(current===photoGeneration){$('status').textContent='הדפדפן לא הצליח לפתוח את התמונה. אפשר לצלם כ־JPEG או להקליד מספר.';record('photo','unsupported-codec');}}
    finally{URL.revokeObjectURL(url);if(activeUrl===url)activeUrl=null;}
  });
  $('decode').addEventListener('click',()=>{
    if(!hasImage||decoding)return;decoding=true;$('decode').disabled=true;const current=photoGeneration;$('status').textContent='קורא ברקוד…';
    setTimeout(()=>{try{if(current!==photoGeneration||!hasImage)return;const result=reader.decodeFromCanvas($('image'));showResult(result.getText());$('status').textContent='הקריאה הושלמה. התוצאה אינה נשמרת כספר.';record('barcode','decoded');}catch{if(current===photoGeneration){$('barcode').textContent='לא נמצא ברקוד קריא.';$('status').textContent='נסה צילום ישר וברור יותר, או הקלד את המספר.';record('barcode','not-found');}}finally{decoding=false;$('decode').disabled=!hasImage;}},0);
  });
  $('clear').addEventListener('click',()=>{stop();clearImage();record('photo','cleared');});
  $('validate').addEventListener('click',()=>showResult($('manual').value));
  document.addEventListener('visibilitychange',()=>{if(document.hidden)stop();});
  window.addEventListener('pagehide',()=>{stop();clearImage();});
  $('environment').textContent='סביבה: '+(isSecureContext?'הקשר מאובטח':'נדרשת כתובת HTTPS למצלמה')+'; קריאת ברקוד מקומית.';
  $('export').addEventListener('click',()=>{
    const report={format:'library-camera-feasibility',version:1,executedAt:new Date().toISOString(),secureContext:isSecureContext,userAgent:navigator.userAgent,origin:location.origin,decoder:'@zxing/browser 0.2.1',scope:'Device actions only. No images or barcode values. Real camera LED, 20 real barcodes, accessibility and physical device accuracy require human review.',events};
    const url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='camera-test-report.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  });
  window.cameraProbe=Object.freeze({classifyBarcode});
})();
