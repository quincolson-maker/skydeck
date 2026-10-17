# contact sheet of the evenly spaced chase-cam frames written by tests/chase-follow.js: python3 tools/chase-sheet.py N28027-m [out.png]
import sys, glob
from PIL import Image, ImageDraw
tag=sys.argv[1]; out=sys.argv[2] if len(sys.argv)>2 else f'docs/screenshots/chase-sheet-{tag}.png'
fs=sorted(glob.glob(f'docs/screenshots/cf-{tag}-[0-9].png'))
ims=[Image.open(f).convert('RGB') for f in fs]; mob=ims[0].height>ims[0].width
w=300 if mob else 480; ims=[i.resize((w,int(i.height*w/i.width))) for i in ims]; h=ims[0].height; cols=5; rows=(len(ims)+cols-1)//cols
S=Image.new('RGB',(w*cols,h*rows),(0,0,0))
for k,im in enumerate(ims):
    d=ImageDraw.Draw(im); d.rectangle((0,0,92,13),fill=(0,0,0)); d.text((3,2),f't = {(k+.5)/len(ims)*100:.0f}% of flight',fill=(255,255,255)); S.paste(im,((k%cols)*w,(k//cols)*h))
S.save(out); print(out,S.size)
