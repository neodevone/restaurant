// src/config/upload.ts
import multer from 'multer';
import path from 'path';
import fs from 'fs';

// Carpeta donde se guardan las imágenes
const UPLOAD_DIR = path.join(__dirname, '../../public/imagenes/articulos');

// Crear carpeta si no existe
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (req, _file, cb) => {
    // Nombre: ID del artículo + .jpg
    const articuloID = req.params.id;
    cb(null, `${articuloID}.jpg`);
  },
});

const fileFilter = (_req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  const tiposPermitidos = ['image/jpeg', 'image/png', 'image/webp'];
  if (tiposPermitidos.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Solo se permiten imágenes JPG, PNG o WEBP'));
  }
};

export const uploadImagen = multer({
  storage,
  fileFilter,
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB máximo
});