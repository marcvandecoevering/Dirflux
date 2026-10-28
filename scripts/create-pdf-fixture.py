# Synthetic PDF regression fixture, created entirely from geometric color bars.
import io
from pathlib import Path
from PIL import Image, ImageDraw
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader
from pypdf import PdfReader, PdfWriter
from pypdf.generic import NameObject
image = Image.new('RGB', (120, 60))
draw = ImageDraw.Draw(image)
for x, color in [(0, '#e53935'), (40, '#43a047'), (80, '#1e88e5')]:
    draw.rectangle((x, 0, x+39, 59), fill=color)
jpx = io.BytesIO()
image.save(jpx, format='JPEG2000', irreversible=False)
source = io.BytesIO()
page = canvas.Canvas(source, pagesize=(360, 240), invariant=1)
page.setFont('Helvetica', 18)
page.drawString(30, 200, 'JPEG 2000 decoder check')
page.drawImage(ImageReader(image), 30, 60, width=300, height=120)
page.setFont('Helvetica', 11)
page.drawString(30, 35, 'Expected: red | green | blue')
page.showPage(); page.save()
writer = PdfWriter()
writer.clone_document_from_reader(PdfReader(source))
for reference in writer.pages[0]['/Resources']['/XObject'].values():
    obj = reference.get_object()
    if obj.get('/Subtype') == '/Image':
        obj._data = jpx.getvalue()
        obj[NameObject('/Filter')] = NameObject('/JPXDecode')
        obj.pop('/DecodeParms', None)
output = Path(__file__).resolve().parents[1] / 'test/fixtures/pdf/jpeg2000.pdf'
with output.open('wb') as stream:
    writer.write(stream)
assert '/JPXDecode' in [obj.get_object().get('/Filter') for obj in PdfReader(output).pages[0]['/Resources']['/XObject'].values()]
print(output)
