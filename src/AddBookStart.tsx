import { Sheet } from './Sheet';

export type AddMethod = 'manual' | 'barcode' | 'vision' | 'catalog' | 'shelf';
const methods: { id: AddMethod; title: string; description: string }[] = [
  { id: 'barcode', title: 'סריקת ברקוד או הקלדת מזהה', description: 'ISBN תקין מפעיל חיפוש ומציג תוצאות.' },
  { id: 'vision', title: 'זיהוי ספר מתמונה', description: 'כריכה, גב או שדרה — בדיקה לפני שמירה.' },
  { id: 'shelf', title: 'צילום מדף בכמה תמונות', description: 'הוספת כמה ספרים בסקירה אחת.' },
  { id: 'catalog', title: 'חיפוש בקטלוגים', description: 'חיפוש לפי שם, מחבר או מזהה.' },
  { id: 'manual', title: 'הוספה ידנית', description: 'אפשר להתחיל בשם בלבד ולהשלים אחר כך.' },
];
export function AddBookStart({ onClose, onChoose }: { onClose: () => void; onChoose: (method: AddMethod) => void }) {
  return <Sheet title="הוספת ספר" onClose={onClose}><p>איך תרצה להוסיף לספרייה?</p><div className="add-methods">{methods.map(method => <button type="button" aria-label={method.title} aria-describedby={'add-' + method.id} className="secondary add-method" key={method.id} onClick={() => onChoose(method.id)}><strong>{method.title}</strong><span id={'add-' + method.id}>{method.description}</span></button>)}</div></Sheet>;
}
