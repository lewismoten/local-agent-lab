import { useEffect, useState } from 'react';
import { straightenCrop, type CropCorners } from './visionCrop';

export default function CropPreview({ image, corners }: { image: Blob; corners: CropCorners }) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    let current = true;
    let objectUrl = '';
    setUrl(''); setError('');
    void straightenCrop(image, corners).then(blob => {
      objectUrl = URL.createObjectURL(blob);
      if (current) setUrl(objectUrl);
      else URL.revokeObjectURL(objectUrl);
    }).catch(reason => { if (current) setError(reason instanceof Error ? reason.message : String(reason)); });
    return () => { current = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [image, corners]);
  return <figure className="vision-crop-preview">
    {url ? <img src={url} alt="Document straightened from the model's four selected corners"/> : <div role="status">{error || 'Straightening crop…'}</div>}
    <figcaption>Crop from the model’s corners</figcaption>
  </figure>;
}
