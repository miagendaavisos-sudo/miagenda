// Mi Agenda: avisos por evento e informe semanal. Lo ejecuta GitHub Actions cada 5 minutos.
const admin=require('firebase-admin');
const nodemailer=require('nodemailer');
admin.initializeApp({credential:admin.credential.cert(JSON.parse(process.env.FIREBASE_KEY))});
const mailer=nodemailer.createTransport({service:'gmail',auth:{user:process.env.GMAIL_USER,pass:process.env.GMAIL_PASS}});
const db=admin.firestore();

const TODO=['deberes','proyecto','recordatorio'];
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const addDays=(ymd,n)=>{const d=new Date(ymd+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);};
const nice=ymd=>new Date(ymd+'T12:00:00Z').toLocaleDateString('es-ES',{weekday:'long',day:'numeric',month:'long',timeZone:'UTC'});

function now(tz){
  const o={};
  new Intl.DateTimeFormat('en-CA',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',weekday:'short',hourCycle:'h23'})
    .formatToParts(new Date()).forEach(p=>o[p.type]=p.value);
  return {date:`${o.year}-${o.month}-${o.day}`,time:`${o.hour}:${o.minute}`,dow:['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].indexOf(o.weekday)+1};
}
async function send(uid,subject,html){
  const u=await admin.auth().getUser(uid);
  if(!u.email||!u.emailVerified) return false;
  await mailer.sendMail({from:`Mi Agenda <${process.env.GMAIL_USER}>`,to:u.email,subject,html});
  return true;
}

const pc={};
const prefsOf=async uid=>pc[uid]||(pc[uid]=(await db.doc(`users/${uid}/prefs/main`).get()).data()||{});
async function reminders(){
  const snap=await db.collectionGroup('items').where('reminded','==',false).where('remindAt','<=',Date.now()).get();
  for(const d of snap.docs){
    const it=d.data(), uid=d.ref.parent.parent.id;
    if((await prefsOf(uid)).remindersOn===false){await d.ref.update({reminded:true});continue;}
    const html=`<h2>${esc(it.title)}</h2><p>${nice(it.date)}${it.time?' a las '+esc(it.time):''}</p>${it.notes?`<p>${esc(it.notes)}</p>`:''}<p style="color:#667">Aviso de Mi Agenda</p>`;
    if(await send(uid,'Aviso: '+it.title,html).catch(()=>false)) await d.ref.update({reminded:true});
  }
}

function section(title,list,subs){
  if(!list.length) return `<h3>${title}</h3><p style="color:#667">Nada.</p>`;
  return `<h3>${title}</h3><ul>`+list.map(i=>`<li><b>${esc(i.title)}</b> (${esc(i.cat)}${subs[i.subject]?' · '+esc(subs[i.subject]):''}) – ${nice(i.date)}${i.time?' '+esc(i.time):''}</li>`).join('')+'</ul>';
}
async function reports(){
  const snap=await db.collectionGroup('prefs').get();
  for(const d of snap.docs){
    const P=d.data(); if(!P.reportOn) continue;
    const n=now(P.tz||'Europe/Madrid');
    if(n.dow!==P.reportDay||n.time<(P.reportTime||'00:00')||P.lastReport===n.date) continue;
    const uid=d.ref.parent.parent.id, user=db.collection('users').doc(uid);
    const [is,ss]=await Promise.all([user.collection('items').get(),user.collection('subjects').get()]);
    const subs={}; ss.docs.forEach(s=>subs[s.id]=s.data().name);
    const items=is.docs.map(x=>x.data()).sort((a,b)=>(a.date+(a.time||'')).localeCompare(b.date+(b.time||'')));
    const end=addDays(n.date,6), todo=i=>TODO.includes(i.cat);
    const week=items.filter(i=>i.date>=n.date&&i.date<=end);
    const late=items.filter(i=>todo(i)&&!i.done&&i.date<n.date);
    const pend=week.filter(i=>todo(i)&&!i.done);
    const done=items.filter(i=>todo(i)&&i.done&&i.date>=addDays(n.date,-7)&&i.date<=end);
    const html=`<h1>Tu semana en Mi Agenda</h1><p>Del ${nice(n.date)} al ${nice(end)}.</p>`+
      section('Esta semana',week,subs)+section('Pendiente atrasado',late,subs)+section('Pendiente esta semana',pend,subs)+section('Hecho',done,subs);
    if(await send(uid,'Tu informe semanal de Mi Agenda',html).catch(()=>false)) await d.ref.update({lastReport:n.date});
  }
}

reminders().then(reports).then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);});
