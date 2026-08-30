/**
 * Butun server-side kod (api/*.js va server.js) uchun YAGONA admin UID
 * manbai. Ilgari bu qiymat 6 xil joyda (firestore.rules, broadcast.js,
 * delete-user.js, server.js x2, modules/config.js, modules/view-users.js)
 * qo'lda nusxalangan edi — admin UID kelajakda o'zgarsa (masalan admin
 * akkaunt almashtirilsa), ayrim joylarni unutib qoldirish xavfi bor edi.
 *
 * MUHIM CHEKLOV: Firestore Security Rules (firestore.rules) o'zga JS
 * faylni import QILA OLMAYDI — bu Firestore qoidalar tilining tub
 * xususiyati, kamchilik emas. Shu sababli o'sha faylda bitta hardcode
 * baribir qoladi — lekin endi u custom claim bilan zaxiralangan (pastga
 * qarang), shu bilan bitta manba (bu fayl) + bitta zaxira (claim)
 * qoladi, 6 ta tarqoq nusxa emas.
 */
export const ADMIN_UID = 'cS9Riz2K4xgW1i4PVboWoQfhGok2';
