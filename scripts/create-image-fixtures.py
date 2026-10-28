"""Create tiny, synthetic format fixtures; never reads user images."""
from pathlib import Path
from PIL import Image, ImageDraw

destination = Path(__file__).resolve().parent.parent / 'test' / 'fixtures' / 'images'
destination.mkdir(parents=True, exist_ok=True)
frames = []
for color in ['#1967d2', '#e04535']:
    frame = Image.new('RGBA', (32, 32), color)
    ImageDraw.Draw(frame).rectangle((10, 10, 21, 21), fill='white')
    frames.append(frame)
frames[0].save(destination / 'animated.apng', save_all=True,
               append_images=frames[1:], duration=600, loop=0, format='PNG')
frames[0].save(destination / 'icon.ico', sizes=[(16, 16), (32, 32)], format='ICO')
