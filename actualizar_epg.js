const fs = require('fs');
const axios = require('axios');
const xml2js = require('xml2js');
const zlib = require('zlib');

// Ruta de tu archivo JSON en el repositorio
const RUTA_JSON = './meta/tv/canales.json';

// Caché en memoria para evitar descargar la misma EPG varias veces
const epgCache = {};

async function descargarYParsearEPG(epgUrl) {
  if (epgCache[epgUrl]) {
    return epgCache[epgUrl];
  }

  try {
    console.log(`Descargando EPG desde: ${epgUrl}`);

    // Pedimos la respuesta como 'arraybuffer' para manejar datos comprimidos o binarios sin corrupción
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

    // Verificamos si el buffer inicia con los bytes mágicos de GZIP (0x1f 0x8b)
    if (buffer.length > 2 && buffer[0] === 0x1f && buffer[1] === 0x8b) {
      buffer = zlib.gunzipSync(buffer);
    } else {
      // Intenta descomprimir en caso de compresión zlib genérica
      try {
        buffer = zlib.inflateSync(buffer);
      } catch (e) {
        // Si no está comprimido, se deja como está
      }
    }

    xmlText = buffer.toString('utf8');

    // Parsear el XML resultante
    const parser = new xml2js.Parser();
    const result = await parser.parseStringPromise(xmlText);
    
    // Guardar en caché
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

function buscarProgramaActual(xmlResult, tvgId) {
  if (!xmlResult || !xmlResult.tv || !xmlResult.tv.programme) {
    return "Sin guía disponible";
  }

  const ahora = new Date();
  const programas = xmlResult.tv.programme.filter(p => p.$&& p.$.channel === tvgId);

  for (const prog of programas) {
    const inicio = parsearFechaXMLTV(prog.$.start);
    const fin = parsearFechaXMLTV(prog.$.stop);

    if (inicio && fin && ahora >= inicio && ahora < fin) {
      let titulo = prog.title ? prog.title[0] : "Programa sin título";
      if (typeof titulo === 'object') {
        titulo = titulo._ || titulo;
      }
      return titulo;
    }
  }

  return "Sin información de programa";
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
      const programaActual = buscarProgramaActual(xmlData, meta.tvgId);
      console.log(`[${meta.name}] -> Programa actual: ${programaActual}`);

      meta.currentProgram = programaActual;

      const descripcionLimpia = (meta.description || '').replace(/^🔴 EN VIVO AHORA: .*\n\n/, '');
      meta.description = `🔴 EN VIVO AHORA: ${programaActual}\n\n${descripcionLimpia}`;
    }

    fs.writeFileSync(RUTA_JSON, JSON.stringify(json, null, 2), 'utf8');
    console.log('✅ Archivo JSON actualizado correctamente.');

  } catch (error) {
    console.error('Error durante la actualización:', error.message);
    process.exit(1);
  }
}

actualizarTodosLosCanales();
