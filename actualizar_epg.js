const fs = require('fs');
const axios = require('axios');
const xml2js = require('xml2js');

// Nombre de tu archivo JSON en el repositorio
const RUTA_JSON = './catalog/tv/mogo-canales.json';

async function actualizarJSON() {
  try {
    // 1. Leer tu JSON actual
    const dataRaw = fs.readFileSync(RUTA_JSON, 'utf8');
    const json = JSON.parse(dataRaw);
    const meta = json.meta;

    if (!meta.epgUrl || !meta.tvgId) {
      console.log('No se encontró epgUrl o tvgId en el JSON.');
      return;
    }

    // 2. Descargar la EPG XML
    console.log(`Descargando EPG desde: ${meta.epgUrl}`);
    const response = await axios.get(meta.epgUrl, { timeout: 15000 });

    // 3. Parsear XML
    const parser = new xml2js.Parser();
    const result = await parser.parseStringPromise(response.data);

    const ahora = new Date();
    let programaActual = "Sin información disponible";

    // 4. Buscar la programación del canal
    const programas = result.tv.programme.filter(p => p.$.channel === meta.tvgId);

    for (const prog of programas) {
      const strStart = prog.$.start;
      const strStop = prog.$.stop;

      // Convertir fechas XMLTV (YYYYMMDDHHMMSS +HHMM) a Date UTC
      const inicio = parsearFechaXMLTV(strStart);
      const fin = parsearFechaXMLTV(strStop);

      if (ahora >= inicio && ahora < fin) {
        programaActual = prog.title[0]._ || prog.title[0];
        if (typeof programaActual === 'object') programaActual = programaActual._ || '';
        break;
      }
    }

    console.log(`Programa actual detectado: ${programaActual}`);

    // 5. Actualizar los campos del JSON
    meta.currentProgram = programaActual;
    
    // Guardamos la descripción base o actualizamos solo el encabezado
    const descripcionLimpia = meta.description.replace(/^🔴 EN VIVO AHORA: .*\n\n/, '');
    meta.description = `🔴 EN VIVO AHORA: ${programaActual}\n\n${descripcionLimpia}`;

    // 6. Guardar cambios en el archivo .json
    fs.writeFileSync(RUTA_JSON, JSON.stringify(json, null, 2), 'utf8');
    console.log('Archivo JSON actualizado correctamente.');

  } catch (error) {
    console.error('Error procesando la EPG:', error.message);
    process.exit(1);
  }
}

function parsearFechaXMLTV(str) {
  const y = parseInt(str.substring(0, 4), 10);
  const m = parseInt(str.substring(4, 6), 10) - 1;
  const d = parseInt(str.substring(6, 8), 10);
  const h = parseInt(str.substring(8, 10), 10);
  const min = parseInt(str.substring(10, 12), 10);
  return new Date(Date.UTC(y, m, d, h, min));
}

actualizarJSON();
