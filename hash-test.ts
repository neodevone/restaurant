// hash-test.ts  (en la raíz del proyecto, no en src)
import bcrypt from 'bcryptjs';

async function main() {
  const password = 'cajero123';
  const hash = await bcrypt.hash(password, 12);
  console.log('Hash generado:', hash);
  
  // Verificar que funciona
  const valido = await bcrypt.compare(password, hash);
  console.log('Verificación:', valido); // debe ser true
}

main();