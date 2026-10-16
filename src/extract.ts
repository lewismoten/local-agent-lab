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
      pages.push(content.items.map(item => 'str' in item ? item.str : '').join(' '));
    }
    return pages.join('\n\n');
  }
  if (/\.(txt|md|markdown)$/i.test(file.name)) return file.text();
  throw new Error('Choose a PDF, TXT, or Markdown file.');
}
