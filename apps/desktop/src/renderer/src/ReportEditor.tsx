import { CKEditor } from '@ckeditor/ckeditor5-react'
import {
  BlockQuote,
  Bold,
  ClassicEditor,
  Essentials,
  Image,
  ImageResize,
  ImageStyle,
  ImageToolbar,
  ImageUpload,
  Italic,
  Link,
  List,
  Paragraph,
  Strikethrough,
  Underline,
  type Editor,
  type FileLoader,
} from 'ckeditor5'
import 'ckeditor5/ckeditor5.css'

const savedImages = new Map<string, string>()

const editorConfig = {
  licenseKey: 'GPL',
  plugins: [
    Essentials,
    Paragraph,
    Bold,
    Italic,
    Underline,
    Strikethrough,
    List,
    Link,
    BlockQuote,
    Image,
    ImageUpload,
    ImageToolbar,
    ImageStyle,
    ImageResize,
  ],
  toolbar: [
    'bold',
    'italic',
    'underline',
    'strikethrough',
    '|',
    'link',
    '|',
    'bulletedList',
    'numberedList',
    'blockQuote',
    '|',
    'uploadImage',
  ],
  placeholder: 'Write a message',
  image: {
    toolbar: ['imageStyle:inline', 'imageStyle:block'],
    upload: { types: ['png', 'jpeg', 'jpg', 'gif', 'webp'] },
  },
}

export function ReportEditor({
  initial,
  disabled = false,
  onChange,
  onError,
}: {
  initial: string
  disabled?: boolean
  onChange: (html: string) => void
  onError: (message: string) => void
}) {
  return (
    <div className="report-editor">
      <CKEditor
        editor={ClassicEditor}
        data={initial}
        disabled={disabled}
        config={editorConfig}
        onReady={(editor) => {
          keepImageErrorsInline(editor, onError)
          bindImageUpload(editor)
          watchPastedDataImages(editor)
          void showSavedImages(editor)
        }}
        onChange={(_event, editor) => onChange(storedHtml(editor.getData()))}
      />
    </div>
  )
}

function keepImageErrorsInline(editor: Editor, onError: (message: string) => void): void {
  if (!editor.plugins.has('Notification')) return
  const notification = editor.plugins.get('Notification') as {
    on: (
      event: string,
      callback: (evt: { stop: () => void }, data: { message?: string }) => void,
      options?: { priority: string },
    ) => void
  }
  notification.on(
    'show:warning',
    (evt, data) => {
      evt.stop()
      onError(data.message || 'The image could not be added.')
    },
    { priority: 'highest' },
  )
}

function bindImageUpload(editor: Editor): void {
  const repository = editor.plugins.get('FileRepository') as {
    createUploadAdapter: (loader: FileLoader) => ReportImageAdapter
  }
  repository.createUploadAdapter = (loader) => new ReportImageAdapter(loader)
}

class ReportImageAdapter {
  constructor(private readonly loader: FileLoader) {}

  async upload(): Promise<{ default: string }> {
    const file = await this.loader.file
    if (!file) throw new Error('Choose an image.')
    if (file.size > 5 * 1024 * 1024) throw new Error('Images must be 5 MB or smaller.')
    const saved = await uploadReportImage({
      contentType: await imageContentType(file),
      data: await fileToBase64(file),
    })
    const preview = URL.createObjectURL(file)
    savedImages.set(preview, saved.path)
    return { default: preview }
  }

  abort(): void {}
}

async function showSavedImages(editor: Editor): Promise<void> {
  const html = editor.getData()
  const paths = html.match(/\/api\/v1\/reports\/images\/[0-9a-f-]{36}/gi) ?? []
  let next = html
  for (const path of paths) {
    try {
      const image = await window.screenvault.readReportImage(path)
      const bytes = Uint8Array.from(atob(image.data), (char) => char.charCodeAt(0))
      const preview = URL.createObjectURL(new Blob([bytes], { type: image.contentType }))
      savedImages.set(preview, path)
      next = next.split(path).join(preview)
    } catch {
      // A missing preview keeps the saved image path in the report.
    }
  }
  if (next !== html) editor.setData(next)
}

function watchPastedDataImages(editor: Editor): void {
  let replacing = false
  editor.model.document.on('change:data', () => {
    if (replacing) return
    const html = editor.getData()
    const found = [...html.matchAll(/src="(data:image\/(?:png|jpeg|gif|webp);base64,[^"]+)"/gi)]
    if (found.length === 0) return
    replacing = true
    void replaceDataImages(
      editor,
      html,
      found.map((match) => match[1] ?? ''),
    ).finally(() => {
      replacing = false
    })
  })
}

async function replaceDataImages(editor: Editor, html: string, sources: string[]): Promise<void> {
  let next = html
  for (const source of sources) {
    const header = /^data:(image\/[a-z0-9.+-]+);base64,/i.exec(source)
    const contentType = header?.[1] === 'image/jpg' ? 'image/jpeg' : (header?.[1] ?? '')
    const data = source.slice(source.indexOf(',') + 1)
    if (!contentType.startsWith('image/') || data.length > 8_000_000) {
      next = next.split(source).join('')
      continue
    }
    try {
      const saved = await uploadReportImage({ contentType, data })
      const bytes = Uint8Array.from(atob(data), (char) => char.charCodeAt(0))
      const preview = URL.createObjectURL(new Blob([bytes], { type: contentType }))
      savedImages.set(preview, saved.path)
      next = next.split(source).join(preview)
    } catch {
      next = next.split(source).join('')
    }
  }
  if (next !== html) editor.setData(next)
}

function storedHtml(html: string): string {
  let next = html
  for (const [preview, path] of savedImages) next = next.split(preview).join(path)
  return next
}

async function imageContentType(file: File): Promise<string> {
  if (file.type === 'image/jpg') return 'image/jpeg'
  if (['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(file.type)) return file.type
  const head = new Uint8Array(await file.slice(0, 12).arrayBuffer())
  const ascii = String.fromCharCode(...head)
  if (head[0] === 0x89 && ascii.startsWith('PNG', 1)) return 'image/png'
  if (head[0] === 0xff && head[1] === 0xd8) return 'image/jpeg'
  if (ascii.startsWith('GIF')) return 'image/gif'
  if (ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP') return 'image/webp'
  throw new Error('Paste a PNG, JPEG, GIF, or WebP image.')
}

function uploadReportImage(input: { contentType: string; data: string }) {
  const upload = window.screenvault.uploadReportImage
  if (typeof upload !== 'function') {
    throw new Error('Quit WorkSphere completely, open it again, then paste the image.')
  }
  return upload(input)
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('The image could not be read.'))
    reader.onload = () => {
      const value = String(reader.result ?? '')
      resolve(value.slice(value.indexOf(',') + 1))
    }
    reader.readAsDataURL(file)
  })
}

export function visibleReportText(value: string): string {
  const text = value
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim()
  if (text) return text
  return /<img\b/i.test(value) ? 'image' : ''
}

export function toEditorHtml(text: string): string {
  const value = text.trim()
  if (!value) return ''
  if (/<\/?[a-z][^>]*>/i.test(value)) return value
  return value
    .split(/\n{2,}/)
    .map((block) => `<p>${escapeHtml(block).replace(/\n/g, '<br>')}</p>`)
    .join('')
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
