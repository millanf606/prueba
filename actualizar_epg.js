const fs = require('fs');
const path = require('path');
const axios = require('axios');
const xml2js = require('xml2js');
const zlib = require('zlib');

// Rutas principales del proyecto
const RUTA_CATALOGO = './catalog/tv/mogo-canales.json';
const CARPETA_META = './meta/tv';

// Caché para no repetir descargas de la misma EPG
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
    if (buffer.length > 2 && buffer[0] === 0x1f && buffer[1] === 0x8b) {
      buffer = zlib.gunzipSync(buffer);
    } else {
      try {
        buffer = zlib.inflateSync(buffer);
      } catch (e) {}
    }

    const xmlText = buffer.toString('utf8');
    const parser = new xml2js.Parser();
    const result = await parser.parseStringPromise(xmlText);
    
    epgCache[epgUrl] = result;
    return result;
  } catch (error) {
    console.error(`Error al descargar EPG (${epgUrl}):`, error.message);
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
    return { titulo: "Sin guía disponible", descripcion: "" };
  }

  const ahora = new Date();
  const programas = xmlResult.tv.programme.filter(p => p.$&& p.$.channel === tvgId);

  for (const prog of programas) {
    const inicio = parsearFechaXMLTV(prog.$.start);
    const fin = parsearFechaXMLTV(prog.$.stop);

    if (inicio && fin && ahora >= inicio && ahora < fin) {
      let titulo = prog.title ? prog.title[0] : "Programa sin título";
      if (typeof titulo === 'object') titulo = titulo._ || titulo;

      let descripcion = "";
      if (prog.desc && prog.desc[0]) {
        descripcion = typeof prog.desc[0] === 'object' ? (prog.desc[0]._ || '') : prog.desc[0];
      }

      return { titulo, descripcion };
    }
  }

  return { titulo: "Sin información de programa", descripcion: "" };
}

async function procesarTodo() {
  try {
    // 1. Asegurar que exista la carpeta meta/tv/
    if (!fs.existsSync(CARPETA_META)) {
      fs.mkdirSync(CARPETA_META, { recursive: true });
    }

    // 2. Leer el catálogo único principal
    const dataRaw = fs.readFileSync(RUTA_CATALOGO, 'utf8');
    const json = JSON.parse(dataRaw);
    const listaCanales = Array.isArray(json) ? json : (json.metas || json.channels || []);

    if (listaCanales.length === 0) {
      console.log("No se encontraron canales en el catálogo.");
      return;
    }

    console.log(`Procesando ${listaCanales.length} canales...`);

    for (const meta of listaCanales) {
      if (!meta.epgUrl || !meta.tvgId) {
        console.log(`Canal "${meta.name || meta.id}" omitido (falta epgUrl o tvgId).`);
        continue;
      }

      // Descargar EPG y obtener datos del programa actual
      const xmlData = await descargarYParsearEPG(meta.epgUrl);
      const programa = buscarProgramaActual(xmlData, meta.tvgId);

      console.log(`[${meta.name}] -> Programa actual: ${programa.titulo}`);

      // Actualizar campos del programa
      meta.currentProgram = programa.titulo;
      meta.currentProgramDesc = programa.descripcion;

      const infoPrograma = programa.descripcion 
        ? `EN VIVO AHORA: ${programa.titulo}\n${programa.descripcion}`
        : `EN VIVO AHORA: ${programa.titulo}`;

      if (!meta.descriptionBase) {
        meta.descriptionBase = meta.description 
          ? meta.description.replace(/^EN VIVO AHORA:[\s\S]*?\n\n/, '') 
          : `Canal ${meta.name}`;
      }

      meta.description = `${infoPrograma}\n\n${meta.descriptionBase}`;

      // 3. Generar dinámicamente el archivo individual dentro de meta/tv/{id}.json
      const rutaMetaIndividual = path.join(CARPETA_META, `${meta.id}.json`);
      const contenidoMetaIndividual = {
        meta: {
          id: meta.id,
          type: meta.type || "tv",
          name: meta.name,
          poster: meta.poster,
          logo: meta.logo,
          background: meta.background,
          posterShape: meta.posterShape || "poster",
          genres: meta.genres || [],
          description: meta.description
        }
      };

      fs.writeFileSync(rutaMetaIndividual, JSON.stringify(contenidoMetaIndividual, null, 2), 'utf8');
      console.log(`  └─ Archivo generado: ${rutaMetaIndividual}`);
    }

    // 4. Guardar el catálogo principal actualizado
    fs.writeFileSync(RUTA_CATALOGO, JSON.stringify(json, null, 2), 'utf8');
    console.log('✅ Catálogo y archivos meta individuales actualizados con éxito.');

  } catch (error) {
    console.error('Error procesando el flujo:', error.message);
    process.exit(1);
  }
}

procesarTodo();
