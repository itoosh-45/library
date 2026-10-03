export function StarRating({ value, onChange, disabled }: { value: number | null; onChange: (value: number | null) => void; disabled?: boolean }) {
  return <div className="star-rating"><span>הדירוג שלי</span><div className="stars" role="group" aria-label="דירוג הספר">
    {[1, 2, 3, 4, 5].map(star => <button key={star} type="button" disabled={disabled} aria-label={`דירוג ${star} מתוך 5`} aria-pressed={(value ?? 0) >= star} onClick={() => onChange(star)}>
      <svg viewBox="0 0 32 32" aria-hidden="true"><path d="m16 3 4 8 9 1.3-6.5 6.3L24 28l-8-4.4L8 28l1.5-9.4L3 12.3l9-1.3Z" /></svg>
    </button>)}</div>{value && <><span>{value}/5</span><button className="clear-rating" type="button" disabled={disabled} onClick={() => onChange(null)}>ניקוי דירוג</button></>}
  </div>;
}
