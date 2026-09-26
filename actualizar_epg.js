const fs = require('fs');
const axios = require('axios');
const xml2js = require('xml2js');
const zlib = require('zlib');

// Ruta de tu archivo JSON en el repositorio
const RUTA_JSON = './catalog/tv/mogo-canales.json';

// Caché en memoria para evitar descargar la misma EPG varias veces
const epgCache = {};

async function descargarYParsearEPG(epgUrl) {
  if (epgCache[epgUrl]) {
    return epgCache[epgUrl];
  }

  try {
    console.log(`Descargando EPG desde: ${epgUrl}`);

    const response = await axios.get(epgUrl, {
      responseType: 'arraybuffer',
      headers: {
        'Accept-Encoding': 'gzip, deflate, br',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
      },
      timeout: 25000
    });

    let buffer = response.data;
    let xmlText = '';

    if (buffer.length > 2 && buffer[0] === 0x1f && buffer[1] === 0x8b) {
      buffer = zlib.gunzipSync(buffer);
    } else {
      try {
        buffer = zlib.inflateSync(buffer);
      } catch (e) {
        // No está comprimido
      }
    }

    xmlText = buffer.toString('utf8');

    const parser = new xml2js.Parser();
    const result = await parser.parseStringPromise(xmlText);
    
    epgCache[epgUrl] = result;
    return result;
  } catch (error) {
    console.error(`Error al descargar o parsear EPG (${epgUrl}):`, error.message);
    return null;
  }
}

function parsearFechaXMLTV(str) {
  if (!str || str.length < 12) return null;
  const y = parseInt(str.substring(0, 4), 10);
  const m = parseInt(str.substring(4, 6), 10) - 1;
  const d = parseInt(str.substring(6, 8), 10);
  const h = parseInt(str.substring(8, 10), 10);
  const min = parseInt(str.substring(10, 12), 10);
  return new Date(Date.UTC(y, m, d, h, min));
}

// Ahora devuelve un objeto con título y descripción
function buscarProgramaActual(xmlResult, tvgId) {
  if (!xmlResult || !xmlResult.tv || !xmlResult.tv.programme) {
    return { titulo: "Sin guía disponible", descripcion: "" };
  }

  const ahora = new Date();
  const programas = xmlResult.tv.programme.filter(p => p.$&& p.$.channel === tvgId);

  for (const prog of programas) {
    const inicio = parsearFechaXMLTV(prog.$.start);
    const fin = parsearFechaXMLTV(prog.$.stop);

    if (inicio && fin && ahora >= inicio && ahora < fin) {
      // Extraer Título
      let titulo = prog.title ? prog.title[0] : "Programa sin título";
      if (typeof titulo === 'object') {
        titulo = titulo._ || titulo;
      }

      // Extraer Descripción (<desc>)
      let descripcion = "";
      if (prog.desc && prog.desc[0]) {
        descripcion = typeof prog.desc[0] === 'object' ? (prog.desc[0]._ || '') : prog.desc[0];
      }

      return { titulo, descripcion };
    }
  }

  return { titulo: "Sin información de programa", descripcion: "" };
}

async function actualizarTodosLosCanales() {
  try {
    const dataRaw = fs.readFileSync(RUTA_JSON, 'utf8');
    const json = JSON.parse(dataRaw);

    const listaCanales = Array.isArray(json) ? json : (json.metas || json.channels || []);

    if (listaCanales.length === 0) {
      console.log("No se encontraron canales para procesar.");
      return;
    }

    console.log(`Procesando ${listaCanales.length} canales...`);

    for (const meta of listaCanales) {
      if (!meta.epgUrl || !meta.tvgId) {
        console.log(`Canal "${meta.name || meta.id}" omitido (falta epgUrl o tvgId).`);
        continue;
      }

      const xmlData = await descargarYParsearEPG(meta.epgUrl);
      const programa = buscarProgramaActual(xmlData, meta.tvgId);
      
      console.log(`[${meta.name}] -> Programa: ${programa.titulo}`);

      // 1. Asignar los campos en el JSON
      meta.currentProgram = programa.titulo;
      meta.currentProgramDesc = programa.descripcion;

      // 2. Formatear la descripción visible en Stremio
      const infoPrograma = programa.descripcion 
        ? `🔴 EN VIVO AHORA: ${programa.titulo}\n📝 ${programa.descripcion}`
        : `🔴 EN VIVO AHORA: ${programa.titulo}`;

      // Mantener la descripción base del canal si existe
      const canalDescripcionBase = meta.descriptionBase || meta.name || "Canal en vivo";
      
      // Guardar la base si no existe previa para no perder la descripción original del canal
      if (!meta.descriptionBase) {
        meta.descriptionBase = meta.description 
          ? meta.description.replace(/^🔴 EN VIVO AHORA:[\s\S]*?\n\n/, '') 
          : `Canal ${meta.name}`;
      }

      meta.description = `${infoPrograma}\n\n${meta.descriptionBase}`;
    }

    fs.writeFileSync(RUTA_JSON, JSON.stringify(json, null, 2), 'utf8');
    console.log('✅ Archivo JSON actualizado correctamente con títulos y descripciones.');

  } catch (error) {
    console.error('Error durante la actualización:', error.message);
    process.exit(1);
  }
}

actualizarTodosLosCanales();
