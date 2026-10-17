export async function extractText(file: File): Promise<string> {
  if (file.name.toLowerCase().endsWith('.pdf')) {
    const [{ getDocument, GlobalWorkerOptions }, { default: workerUrl }] = await Promise.all([
      import('pdfjs-dist'),
      import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
    ]);
    GlobalWorkerOptions.workerSrc = workerUrl;
    const pdf = await getDocument({ data: await file.arrayBuffer() }).promise;
    const pages: string[] = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const content = await (await pdf.getPage(i)).getTextContent();
      let pageText = '';
      let previousY: number | undefined;
      for (const item of content.items) {
        if (!('str' in item)) continue;
        const y = item.transform[5];
        const newLine = previousY !== undefined && Math.abs(y - previousY) > 3;
        pageText += (newLine ? '\n' : pageText && !pageText.endsWith('\n') ? ' ' : '') + item.str;
        if (item.hasEOL) pageText += '\n';
        previousY = y;
      }
      pages.push(pageText);
    }
    return pages.join('\n\n');
  }
  if (/\.(txt|md|markdown)$/i.test(file.name)) return file.text();
  throw new Error('Choose a PDF, TXT, or Markdown file.');
}
