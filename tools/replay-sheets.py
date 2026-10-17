# builds docs/screenshots/replay-contact-sheet.png and replay-chart.png from tests/replay.js + tests/replay-metrics.mjs output
import json, sys
from PIL import Image, ImageDraw, ImageFont
import matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt
D='docs/'; S=D+'screenshots/'; pre=sys.argv[1] if len(sys.argv)>1 else 'd'
F=json.load(open(D+f'replay-frames-{pre}.json'))['frames']
ims=[]; f=ImageFont.load_default()
for fr in F:
    im=Image.open(S+f"replay-{pre}-{fr['name']}.png").convert('RGB'); w,h=im.size
    c=im.crop((int(w*.3),int(h*.18),int(w*.9),int(h*.78))) if pre=='d' else im.crop((0,int(h*.2),w,int(h*.75)))
    c=c.resize((480,int(480*c.size[1]/c.size[0]))); d=ImageDraw.Draw(c); d.rectangle((0,0,480,16),fill=(0,0,0))
    d.text((4,3),f"{fr['name']}  AGL {fr['agl']} m  pitch {fr['pitch']}  bank {fr['bank']}  gear {fr['gear']}  {'GND' if fr['gnd'] else 'AIR'}",fill=(255,255,255),font=f); ims.append(c)
w,h=ims[0].size; cols=6 if pre=='d' else 6; rows=2
sheet=Image.new('RGB',(w*cols,max(i.size[1] for i in ims)*rows),(0,0,0))
for i,c in enumerate(ims): sheet.paste(c,((i%6)*w,(i//6)*c.size[1]))
sheet.save(S+f'replay-contact-sheet-{pre}.png')
if pre=='d':
    s=json.load(open(D+'replay-series.json')); t0=s['raw'][0]['t']
    r=lambda k:[p[k] for p in s['raw']]; rt=[p['t']-t0 for p in s['raw']]; ct=[p['t']-t0 for p in s['clean']]; ot=[p['t']-t0 for p in s['old']]
    fig,ax=plt.subplots(4,1,figsize=(13,11),sharex=True)
    ax[0].plot(ot,[p['h'] for p in s['old']],color='#d33',lw=1,label='before (v1.2 replay)'); ax[0].plot(rt,r('h'),'.',ms=3,color='#555',label='raw ADS-B baro alt (ground=0)'); ax[0].plot(ct,[p['h'] for p in s['clean']],color='#09c',lw=1.6,label='after (cleaned, anchored)'); ax[0].set_ylabel('altitude m'); ax[0].legend(loc='upper left')
    ax[1].plot(rt,[g*1.944 for g in r('gs')],'.',ms=3,color='#555',label='raw ADS-B gs'); ax[1].plot(ct,[p['spd']*1.944 for p in s['clean']],color='#09c',lw=1.6,label='cleaned'); ax[1].set_ylabel('speed kt'); ax[1].legend()
    ax[2].plot(ot,[p['pitch'] for p in s['old']],color='#d33',lw=1,label='before'); ax[2].plot(ct,[p['pitch'] for p in s['clean']],color='#09c',lw=1.6,label='after'); ax[2].set_ylabel('pitch deg'); ax[2].legend()
    ax[3].plot(ct,[p['bank'] for p in s['clean']],color='#09c'); ax[3].set_ylabel('bank deg (after)'); ax[3].set_xlabel('seconds since first point')
    for a in ax:
        for l in s['lift']: a.axvline(l-t0,color='g',ls='--',lw=.8)
        for l in s['td']: a.axvline(l-t0,color='m',ls='--',lw=.8)
        a.grid(alpha=.3)
    fig.suptitle(f"N291KY KPAH→KDTO replay: raw vs cleaned (green = liftoff, magenta = touchdown)"); fig.tight_layout(); fig.savefig(S+'replay-chart.png',dpi=90)
