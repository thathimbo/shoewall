import { useImageUrl } from '../store';
import type { Pair } from '../types';

export function PairThumb({
  pair, large, flip, className,
}: { pair: Pair; large?: boolean; flip?: boolean; className?: string }) {
  const url = useImageUrl(pair.cutoutImageId ?? pair.photoImageId);
  if (!url) {
    return (
      <div className={`thumb ${large ? 'lg ' : ''}empty ${className ?? ''}`} aria-hidden="true">
        no image
      </div>
    );
  }
  return (
    <img
      className={`thumb ${large ? 'lg ' : ''}${className ?? ''}`}
      src={url}
      alt={`${pair.name} cutout`}
      style={flip ? { transform: 'scaleY(-1)' } : undefined}
    />
  );
}
