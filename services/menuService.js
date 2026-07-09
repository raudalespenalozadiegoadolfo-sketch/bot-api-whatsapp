const products = [
  ["food", "Camarones", "Camarones a la diabla", 180, ["diabla", "camarones diabla"]],
  ["food", "Camarones", "Camarones empanizados", 190, ["camaron empanizado", "camarones empanizados"]],
  ["food", "Camarones", "Camarones al ajo", 180, ["ajo", "camarones ajo"]],
  ["food", "Camarones", "Camarones al ajillo", 180, ["ajillo", "camarones ajillo"]],
  ["food", "Pulpo", "Pulpo a la diabla", 220, ["pulpo diabla"]],
  ["food", "Pulpo", "Pulpo empanizado", 220, ["pulpo empanizado"]],
  ["food", "Pulpo", "Pulpo zarandeado", 220, ["pulpo zarandeado"]],
  ["food", "Filete", "Filete a la diabla", 160, ["filete diabla"]],
  ["food", "Filete", "Filete empanizado", 170, ["filete empanizado"]],
  ["food", "Filete", "Filete al ajo", 170, ["filete ajo"]],
  ["food", "Cocteles", "Coctel de camarón", 190, ["coctel camaron"]],
  ["food", "Cocteles", "Coctel de pulpo", 200, ["coctel pulpo"]],
  ["food", "Cocteles", "Coctel de callo", 250, ["coctel callo"]],
  ["food", "Cocteles", "Coctel mixto", 220, ["coctel mixto"]],
  ["food", "Ceviches", "Ceviche de pescado", 180, ["ceviche pescado"]],
  ["food", "Ceviches", "Ceviche de camarón", 200, ["ceviche camaron"]],
  ["food", "Aguachiles", "Aguachile verde", 190, ["aguachile verde"]],
  ["food", "Aguachiles", "Aguachile rojo", 190, ["aguachile rojo"]],
  ["food", "Aguachiles", "Aguachile negro", 190, ["aguachile negro"]],
  ["food", "Cortes", "Arrachera", 220, ["arrachera"]],
  ["food", "Cortes", "T-bone", 250, ["t bone", "tbone"]],
  ["food", "Cortes", "Rib eye", 270, ["ribeye", "rib eye"]],
  ["drink", "Refrescos", "Coca Cola", 30, ["coca", "coca cola"]],
  ["drink", "Refrescos", "Coca Cola Light", 30, ["coca light"]],
  ["drink", "Refrescos", "Pepsi", 25, ["pepsi"]],
  ["drink", "Refrescos", "Sangría", 25, ["sangria"]],
  ["drink", "Refrescos", "7Up", 25, ["7up", "seven"]],
  ["drink", "Aguas", "Agua de jamaica", 35, ["jamaica"]],
  ["drink", "Aguas", "Agua de arroz", 35, ["arroz", "horchata"]],
  ["drink", "Aguas", "Agua de piña", 35, ["piña", "pina"]],
  ["drink", "Aguas", "Agua de limón", 35, ["limon", "limón"]],
  ["drink", "Micheladas", "Michelada de camarón", 100, ["michelada camaron"]],
  ["drink", "Micheladas", "Michelada Clamato", 80, ["michelada clamato", "clamato"]],
  ["drink", "Micheladas", "Michelada tamarindo", 90, ["michelada tamarindo"]],
  ["drink", "Cervezas", "Corona Extra", 40, ["corona", "corona extra"]],
  ["drink", "Cervezas", "Corona Light", 40, ["corona light"]],
  ["drink", "Cervezas", "Corona Cero", 40, ["corona cero"]],
  ["drink", "Cervezas", "Tecate", 35, ["tecate"]],
  ["drink", "Cervezas", "Tecate Light", 35, ["tecate light"]],
  ["drink", "Cervezas", "Indio", 30, ["indio"]],
  ["drink", "Cervezas", "Ultra", 30, ["ultra"]],
  ["drink", "Cervezas", "Heineken Cero", 35, ["heineken cero"]],
].map(([type, category, name, price, aliases], index) => ({
  id: `p${index}`,
  type,
  category,
  name,
  price,
  aliases,
}));

function getProducts() {
  return products;
}

function getCategories(type) {
  return [...new Set(products.filter(p => p.type === type).map(p => p.category))];
}

function getProductsByCategory(type, category) {
  return products.filter(p => p.type === type && p.category === category);
}

function findProductById(id) {
  return products.find(p => p.id === id);
}

module.exports = {
  products,
  getProducts,
  getCategories,
  getProductsByCategory,
  findProductById,
};