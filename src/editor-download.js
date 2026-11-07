import {buildScene} from './editor-scene-build.js';

// Stored ZIP entries keep the download dependency-free and readable by standard unzip tools.
const encoder = new TextEncoder();
const crcTable = Uint32Array.from({length:256}, (_, value) => {
  for (let bit=0; bit<8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
export function zipFiles(files) {
  const chunks=[], directory=[];
  let offset=0, directorySize=0;
  for (const [name, value] of files) {
    if (!/^[a-zA-Z0-9_./-]+$/.test(name) || name.startsWith('/') || name.split('/').includes('..')) throw new Error('Invalid ZIP path');
    const bytes = typeof value === 'string' ? encoder.encode(value) : value;
    const filename=encoder.encode(name), crc=crc32(bytes);
    const local=new Uint8Array(30+filename.length), l=new DataView(local.buffer);
    l.setUint32(0,0x04034b50,true); l.setUint16(4,20,true);
    l.setUint16(12,33,true); // 1980-01-01
    l.setUint32(14,crc,true); l.setUint32(18,bytes.length,true); l.setUint32(22,bytes.length,true);
    l.setUint16(26,filename.length,true); local.set(filename,30);
    const central=new Uint8Array(46+filename.length), c=new DataView(central.buffer);
    c.setUint32(0,0x02014b50,true); c.setUint16(4,20,true); c.setUint16(6,20,true); c.setUint16(14,33,true);
    c.setUint32(16,crc,true); c.setUint32(20,bytes.length,true); c.setUint32(24,bytes.length,true);
    c.setUint16(28,filename.length,true); c.setUint32(42,offset,true); central.set(filename,46);
    chunks.push(local,bytes); directory.push(central);
    offset+=local.length+bytes.length; directorySize+=central.length;
  }
  const end=new Uint8Array(22), e=new DataView(end.buffer);
  e.setUint32(0,0x06054b50,true); e.setUint16(8,files.size,true); e.setUint16(10,files.size,true);
  e.setUint32(12,directorySize,true); e.setUint32(16,offset,true);
  return new Blob([...chunks,...directory,end],{type:'application/zip'});
}

async function verifiedFetch(url, expected, fetcher, cryptoApi, signal) {
  const response=await fetcher(url,{signal});
  if (!response.ok) throw new Error('A map download file could not load. Check your connection and retry.');
  const bytes=new Uint8Array(await response.arrayBuffer());
  const digest=new Uint8Array(await cryptoApi.subtle.digest('SHA-256',bytes));
  if ([...digest].map(n=>n.toString(16).padStart(2,'0')).join('')!==expected) {
    throw new Error('A map download file failed verification. Reload the page and retry.');
  }
  return bytes;
}

export async function createMapDownload(map, document, url, progress=()=>{}, {
  fetcher=fetch, cryptoApi=globalThis.crypto, signal, coordinates,
}={}) {
  // Clone before the first await: subsequent edits/map switches cannot change this export.
  document=JSON.parse(JSON.stringify(document));
  if (document.settings?.biome !== 'source') throw new Error('Download files requires Biome: Keep source. Set Biome to Keep source and try again.');
  if (!map.download) throw new Error('Download files are unavailable for this map. Reload the page and retry.');
  progress('Checking map download…');
  const manifest=JSON.parse(new TextDecoder().decode(await verifiedFetch(url(map.download.url),map.download.sha256,fetcher,cryptoApi,signal)));
  if (manifest.version!==2 || manifest.map_id!==map.map_id || JSON.stringify(manifest.source)!==JSON.stringify(document.source)) {
    throw new Error('The download belongs to a different map version. Reload the page and retry.');
  }
  const files=new Map();
  for (const resource of manifest.files) {
    progress('Downloading files ' + (files.size+1) + '/' + manifest.files.length + '…');
    const bytes=await verifiedFetch(url(resource.url),resource.sha256,fetcher,cryptoApi,signal);
    if (bytes.length!==resource.bytes || files.has(resource.name)) throw new Error('Invalid map download manifest.');
    files.set(resource.name,bytes);
  }
  progress('Building your map…');
  const decode=name=>new TextDecoder().decode(files.get(name));
  const project=JSON.parse(decode('project.json'));
  const built=buildScene({source:files.get('source.sco'),recipe:decode('scenes-snippet.txt'),
    project,terrain:JSON.parse(decode('terrain.json')),native:JSON.parse(decode('native-assets.json')),document},coordinates);
  const output=new Map([
    ['SceneObj/'+built.scene+'.sco',built.sco],
    ['scenes-snippet.txt',built.recipe],
    ['placements.json',JSON.stringify(document,null,2)+'\n'],
    ['README.txt',installationInstructions(map,built.scene)],
  ]);
  progress('Preparing ZIP…');
  return zipFiles(output);
}

export function attachMapDownload(frame, map, url) {
  const doc=frame.contentDocument, api=frame.contentWindow.MapEditor;
  const button=doc.createElement('button');
  button.id='download-files'; button.textContent='Download files';
  doc.getElementById('export').after(button);
  const note=doc.createElement('p'); note.className='hint';
  note.textContent='Download finished map files and installation instructions. No extra tools needed. Object heights are approximate; Biome must be Keep source.';
  doc.querySelector('header').after(note);
  button.addEventListener('click',async()=>{
    button.disabled=true;
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),120000);
    try {
      const document=api.exportDocument();
      const blob=await createMapDownload(map,document,url,message=>api.status(message),{signal:controller.signal,coordinates:frame.contentWindow.MapCoordinates});
      const href=URL.createObjectURL(blob), link=doc.createElement('a');
      link.href=href; link.download=map.map_id+'-map-files.zip'; link.click();
      setTimeout(()=>URL.revokeObjectURL(href),1000);
      api.status('Map files downloaded. Extract the ZIP and follow README.txt to install locally.');
    } catch(error) {
      api.status(error.name==='AbortError' ? 'Download timed out. Check your connection and retry.' : error.message,true);
    } finally { clearTimeout(timeout); button.disabled=false; }
  });
}

export function installationInstructions(map,scene) {
  return `INSTALL ${map.map_id} LOCALLY

Your map is already built. No Python, commands, or extra software are needed.
The ZIP includes your current objects, height offsets, weather and team spawns.
Use the same game module/version as the rate_maps rotation. These files rely on
that module's existing assets and scripts; they will not work in Native or an
unrelated mod.

1. CLOSE THE GAME AND EXTRACT THE ZIP
Right-click the downloaded ZIP and choose Extract All (or your system's Extract
option). Open the extracted folder.

2. FIND YOUR MODULE AND MAKE A BACKUP
Open your Mount&Blade Warband installation, then Modules, then the module you
use for this rotation. On Steam, use the game's Manage > Browse local files.
Copy that module's scenes.txt and its SceneObj folder to a safe backup folder.

3. COPY THE FINISHED MAP
Open the downloaded SceneObj folder. Copy ${scene}.sco into your module's
SceneObj folder, replacing the file with the same name.
This replaces an EXISTING local map slot. The slot's menu name may stay the same.
If the same-named file or the scene record in step 4 is missing, stop: this kit
does not create new playable slots. Ask your map organizer for the matching module.

4. UPDATE THAT MAP'S SCENE RECORD
Open the module's scenes.txt in a plain text editor, such as Notepad.
Use Find to locate the line starting with:
${scene} ${scene.slice(4)}
Open the downloaded scenes-snippet.txt. Copy all FOUR lines from that file.
In the module's scenes.txt, select the matching line AND the three lines directly
below it, then replace those four lines with the copied four lines.
Save. Keep the header, scene count, and all other map records unchanged.
IMPORTANT: scenes-snippet.txt contains only one map record. Do NOT replace the
whole scenes.txt file, and do NOT append the snippet at the end.

5. PLAY AND CHECK
Start the game using the matching module and choose this existing map slot.
Check the terrain, objects, weather and both team spawns. Object and moved-spawn
heights use the same approximate terrain as the editor; inspect slopes carefully.
Scripted objects still depend on the module's normal game logic.

TO UNDO THE INSTALLATION
Close the game and restore scenes.txt and SceneObj from your backup.

TO CONTINUE EDITING
Open placements.json using Open loadout in the matching rate_maps editor.
Keep it with your map files. You do not need it to play.

These instructions are for a local installation. Adding menu entries or changing
a multiplayer server's rotation is a separate task.
`;
}
