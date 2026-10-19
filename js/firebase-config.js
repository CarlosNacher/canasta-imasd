// 1) Pega aquí la configuración de tu proyecto de Firebase
//    (Consola de Firebase → Configuración del proyecto → Tus apps → App web).
export const firebaseConfig = {
  apiKey: "AIzaSyAyvKfzvlEb-U6m80tcidO170_Ri1aLCI8",
  authDomain: "canasta-imasd.firebaseapp.com",
  projectId: "canasta-imasd",
  storageBucket: "canasta-imasd.firebasestorage.app",
  messagingSenderId: "129294785132",
  appId: "1:129294785132:web:e55d0f0706aecf24d1d649"
};

// 2) ¿Quién cuenta como participante de un mes para el reparto del almuerzo?
//    false → todos los usuarios activos (aunque no hayan tirado ningún día).
//    true  → solo quienes hayan anotado al menos un tiro (acierto o fallo) ese mes.
export const SOLO_CON_TIROS = true;
