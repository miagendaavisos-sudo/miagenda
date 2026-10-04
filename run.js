// Mi Agenda: avisos por evento e informe semanal. Lo ejecuta GitHub Actions cada 5 minutos.
const admin=require('firebase-admin');
const nodemailer=require('nodemailer');
admin.initializeApp({credential:admin.credential.cert(JSON.parse(process.env.FIREBASE_KEY))});
const mailer=nodemailer.createTransport({service:'gmail',auth:{user:process.env.GMAIL_USER,pass:process.env.GMAIL_PASS}});
const db=admin.firestore();
const APP=process.env.APP_URL||'https://miagendaavisos-sudo.github.io/miagenda/';

const TODO=['deberes','proyecto','recordatorio'];
const CAT={evento:['Evento','#5B7FA6'],examen:['Examen','#B5483E'],deberes:['Deberes','#B8893A'],proyecto:['Proyecto','#7C6FB0'],clase:['Clase','#3E9C93'],reunion:['Reunión','#6E7FA0'],cita:['Cita','#3E9C93'],recordatorio:['Recordatorio','#B8893A'],cumple:['Cumpleaños','#C0607F'],viaje:['Viaje','#4F9A5E'],otro:['Otro','#7A8794']};
const cat=id=>CAT[id]||CAT.otro;
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const cap=s=>s.charAt(0).toUpperCase()+s.slice(1);
const addDays=(ymd,n)=>{const d=new Date(ymd+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);};
const nice=ymd=>cap(new Date(ymd+'T12:00:00Z').toLocaleDateString('es-ES',{weekday:'long',day:'numeric',month:'long',timeZone:'UTC'}));

function now(tz){
  const o={};
  new Intl.DateTimeFormat('en-CA',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',weekday:'short',hourCycle:'h23'})
    .formatToParts(new Date()).forEach(p=>o[p.type]=p.value);
  return {date:`${o.year}-${o.month}-${o.day}`,time:`${o.hour}:${o.minute}`,dow:['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].indexOf(o.weekday)+1};
}
async function send(uid,subject,html,text){
  const u=await admin.auth().getUser(uid);
  if(!u.email||!u.emailVerified) return false;
  await mailer.sendMail({from:`Mi Agenda <${process.env.GMAIL_USER}>`,to:u.email,subject,html,text});
  return true;
}

/* ---------- Plantilla común ---------- */
function layout(title,sub,body,why){
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#EEF1F5;font-family:'Segoe UI',Helvetica,Arial,sans-serif;color:#101A25">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#EEF1F5"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #DDE3EA">
<tr><td style="background:#0F2540;padding:24px 28px"><div style="color:#9FB4CC;font-size:12px;letter-spacing:.1em;text-transform:uppercase">Mi Agenda</div>
<div style="color:#fff;font-size:23px;font-weight:600;margin-top:6px;line-height:1.25">${title}</div>${sub?`<div style="color:#C9D6E6;font-size:14px;margin-top:6px">${sub}</div>`:''}</td></tr>
<tr><td style="padding:26px 28px">${body}
<p style="margin:26px 0 0"><a href="${APP}" style="background:#1B4F8F;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-size:14px;font-weight:600;display:inline-block">Abrir Mi Agenda</a></p></td></tr>
<tr><td style="padding:16px 28px;background:#F6F8FB;border-top:1px solid #DDE3EA;color:#667788;font-size:12px;line-height:1.6">${why}<br>Puedes cambiar o desactivar estos correos en Ajustes, dentro de la app.</td></tr>
</table></td></tr></table></body></html>`;
}
const FOOT_TXT=`\n--\nPuedes cambiar o desactivar estos correos en Ajustes: ${APP}`;

/* ---------- Aviso de un registro ---------- */
const HERO={examen:'Tienes un examen',deberes:'Tienes deberes pendientes',proyecto:'Tienes un proyecto',clase:'Tienes una clase',reunion:'Tienes una reunión',cita:'Tienes una cita',recordatorio:'Recordatorio',cumple:'Cumpleaños',viaje:'Tienes un viaje',evento:'Tienes un evento'};
function reminderMail(it,subj){
  const [cn,cc]=cat(it.cat);
  const rows=[['Asignatura',subj],['Fecha',nice(it.date)],['Hora',it.time],['Notas',it.notes]].filter(r=>r[1]);
  const body=`<span style="background:${cc};color:#fff;font-size:12px;font-weight:600;padding:4px 10px;border-radius:99px;display:inline-block">${esc(cn)}</span>
<h2 style="margin:12px 0 4px;font-size:22px;line-height:1.3">${esc(it.title)}</h2>${subj?`<div style="font-size:16px;color:#1B4F8F;font-weight:600">${esc(subj)}</div>`:''}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:18px;border-top:1px solid #E3E8EE">${rows.map(r=>`<tr><td style="padding:10px 0;border-bottom:1px solid #E3E8EE;color:#667788;font-size:13px;width:110px">${r[0]}</td><td style="padding:10px 0;border-bottom:1px solid #E3E8EE;font-size:15px">${esc(r[1])}</td></tr>`).join('')}</table>`;
  const subject=`Aviso: ${cn}${subj?' de '+subj:''} – ${it.title}`;
  const text=`${HERO[it.cat]||'Aviso'}\n\n${cn}: ${it.title}\n`+rows.map(r=>`${r[0]}: ${r[1]}`).join('\n')+FOOT_TXT;
  return {subject,text,html:layout(HERO[it.cat]||'Aviso de tu agenda',esc(nice(it.date))+(it.time?' · '+esc(it.time):''),body,'Recibes este aviso porque activaste "Avisarme por correo" en este registro.')};
}

const pc={};
const prefsOf=async uid=>pc[uid]||(pc[uid]=(await db.doc(`users/${uid}/prefs/main`).get()).data()||{});
async function reminders(){
  const snap=await db.collectionGroup('items').where('reminded','==',false).where('remindAt','<=',Date.now()).get();
  console.log('Avisos pendientes:',snap.size);
  for(const d of snap.docs){
    const it=d.data(), uid=d.ref.parent.parent.id;
    if((await prefsOf(uid)).remindersOn===false){await d.ref.update({reminded:true});continue;}
    const sd=it.subject?await db.doc(`users/${uid}/subjects/${it.subject}`).get():null;
    const m=reminderMail(it,sd&&sd.exists?sd.data().name:'');
    if(await send(uid,m.subject,m.html,m.text).catch(e=>{console.error('ERROR enviando correo:',e.message);return false;})) await d.ref.update({reminded:true});
  }
}

/* ---------- Informe semanal ---------- */
function itemRow(i,subs,withDate){
  const [cn,cc]=cat(i.cat);
  const meta=[cn,subs[i.subject],withDate?nice(i.date):null,i.time].filter(Boolean).join(' · ');
  return `<tr><td style="border-left:4px solid ${cc};padding:9px 12px;background:#F6F8FB"><div style="font-size:15px;font-weight:600${i.done?';text-decoration:line-through;color:#667788':''}">${esc(i.title)}</div><div style="font-size:13px;color:#667788;margin-top:2px">${esc(meta)}</div></td></tr><tr><td style="height:6px;font-size:0;line-height:0">&nbsp;</td></tr>`;
}
const list=rows=>`<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>`;
const head=(t,c)=>`<h3 style="margin:26px 0 10px;padding-bottom:6px;border-bottom:2px solid ${c};font-size:15px;color:${c};text-transform:uppercase;letter-spacing:.05em">${t}</h3>`;
const empty=t=>`<p style="margin:0;color:#667788;font-size:14px">${t}</p>`;
const stat=(n,l,c)=>`<td align="center" style="padding:14px 6px;background:#F6F8FB;border-radius:8px;width:33%"><div style="font-size:28px;font-weight:700;color:${c}">${n}</div><div style="font-size:12px;color:#667788">${l}</div></td>`;

function reportMail(n,end,week,late,pend,done,subs){
  const days=[...new Set(week.map(i=>i.date))];
  const pending=[...late,...pend];
  const body=`<table role="presentation" width="100%" cellpadding="0" cellspacing="6" style="margin:0 -6px"><tr>${stat(week.length,'Esta semana','#1B4F8F')}${stat(pending.length,'Pendientes','#B8893A')}${stat(done.length,'Hechos','#1F7A4D')}</tr></table>`+
    head('Esta semana','#1B4F8F')+(days.length?days.map(dt=>`<div style="font-size:14px;font-weight:600;margin:14px 0 6px">${nice(dt)}</div>`+list(week.filter(i=>i.date===dt).map(i=>itemRow(i,subs,false)).join(''))).join(''):empty('No tienes nada programado esta semana.'))+
    head('Pendiente','#B8893A')+(pending.length?(late.length?`<div style="font-size:13px;color:#B5483E;font-weight:600;margin:0 0 6px">Atrasado</div>`+list(late.map(i=>itemRow(i,subs,true)).join('')):'')+(pend.length?`<div style="font-size:13px;color:#667788;font-weight:600;margin:10px 0 6px">De esta semana</div>`+list(pend.map(i=>itemRow(i,subs,true)).join('')):''):empty('No tienes nada pendiente. ¡Buen trabajo!'))+
    head('Hecho','#1F7A4D')+(done.length?list(done.map(i=>itemRow(i,subs,true)).join('')):empty('Todavía no has marcado nada como hecho.'));
  const ln=(t,a)=>`\n${t}\n`+(a.length?a.map(i=>`- ${i.title} (${[cat(i.cat)[0],subs[i.subject],nice(i.date),i.time].filter(Boolean).join(', ')})`).join('\n'):'- Nada');
  const text=`Tu semana en Mi Agenda\n${nice(n.date)} – ${nice(end)}\n`+ln('ESTA SEMANA',week)+ln('PENDIENTE',pending)+ln('HECHO',done)+FOOT_TXT;
  return {subject:`Tu semana en Mi Agenda: ${week.length} ${week.length===1?'registro':'registros'}, ${pending.length} ${pending.length===1?'pendiente':'pendientes'}`,text,
    html:layout('Tu semana en Mi Agenda',`${nice(n.date)} – ${nice(end)}`,body,'Recibes este informe porque lo activaste en Ajustes.')};
}
async function reports(){
  const snap=await db.collectionGroup('prefs').get();
  console.log('Usuarios con ajustes:',snap.size);
  for(const d of snap.docs){
    const P=d.data(); if(!P.reportOn) continue;
    const n=now(P.tz||'Europe/Madrid');
    console.log('Informe',d.ref.parent.parent.id,'activado:',P.reportOn,'dia',n.dow,'/',P.reportDay,'hora',n.time,'/',P.reportTime,'ultimo:',P.lastReport);
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
    const m=reportMail(n,end,week,late,pend,done,subs);
    if(await send(uid,m.subject,m.html,m.text).catch(e=>{console.error('ERROR enviando correo:',e.message);return false;})) await d.ref.update({lastReport:n.date});
  }
}

reminders().then(reports).then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);});
