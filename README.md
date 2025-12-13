# 🧠 Talent Evaluation  
## Sistema de Evaluación Estructurada de Talento

![Estado](https://img.shields.io/badge/🚀_En_Desarrollo-blue) ![Licencia](https://img.shields.io/badge/Licencia-🔒_Uso_Controlado-red) ![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?logo=javascript&logoColor=black) ![HTML5](https://img.shields.io/badge/HTML5-E34F26?logo=html5&logoColor=white) ![CSS3](https://img.shields.io/badge/CSS3-1572B6?logo=css3&logoColor=white) ![Google_Apps_Script](https://img.shields.io/badge/Google_Apps_Script-Backend-green) ![Google_Sheets](https://img.shields.io/badge/Google_Sheets-Storage-lightgrey) ![GitHub_Pages](https://img.shields.io/badge/GitHub_Pages-Deploy-black?logo=github)

## 📋 Descripción del Sistema
Sistema diseñado para la **evaluación estructurada de candidatos**, enfocado en razonamiento lógico, análisis y pensamiento abstracto, con entrega controlada de preguntas y recolección centralizada de respuestas.

El proyecto separa estrictamente la **interfaz pública** del **banco real de preguntas y la lógica de selección**, garantizando seguridad, trazabilidad y neutralidad en el proceso de evaluación.

## 🛠 Stack Tecnológico
**Backend (Privado):** Google Apps Script (Web App), validación por token  
**Base de Datos:** Google Sheets (almacenamiento de respuestas)  
**Frontend:** HTML5 / CSS3 / JavaScript (ES6+)  

## 🖥️ Infraestructura
**GitHub Pages (Frontend):**
- Hosting estático
- Repositorio público sin contenido sensible
- Comunicación directa con backend privado

**Google Apps Script:**
- Web App con endpoints `GET` y `POST`
- Ejecución bajo cuenta propietaria
- Validación por **TOKEN**
- Opción de control por código de acceso

**Monitoreo:**
- Registro de fecha y hora de cada intento
- Identificación básica de sesión
- Control manual y auditoría posterior

## 🖥️ Estructura del Proyecto
📁 talent-evaluation  
├── 📄 index.html            # Interfaz principal de evaluación  
├── 📄 README.md             # Este documento  
├── 📄 LICENSE               # Uso controlado  
├── 📄 .gitignore  
├── 📂 src/  
│   ├── config.js            # URL del Web App + token  
│   ├── api.js               # Comunicación con Apps Script  
│   ├── evaluation.js        # Renderizado y envío de respuestas  
│   └── utils.js             # Validaciones y utilidades  
└── 📂 docs/  
    └── flow.md              # Flujo general del sistema  

## 🔍 Características Clave
- Selección **aleatoria** de preguntas por evaluación  
- Separación total entre frontend público y backend privado  
- Validación de acceso mediante **TOKEN**  
- Soporte para **códigos de acceso** por candidato o convocatoria  
- Almacenamiento centralizado y trazable de respuestas  
- Arquitectura preparada para ampliación de módulos y criterios  

## 🛡️ Seguridad Avanzada
- Token compartido frontend/backend  
- Banco real de preguntas fuera de GitHub  
- Imposibilidad de inferir respuestas correctas desde el frontend  
- Preparado para control de intentos y expiración de accesos  

## 📊 Métricas de Rendimiento
- Entrega de evaluación < 500 ms  
- Escritura de respuestas en tiempo real  
- Disponibilidad dependiente de Google Apps Script  

## 📝 Gestión de Versiones
- Versionado semántico  
- Reimplementación controlada del Web App  
- Cambios de frontend sin afectar el backend  

💡 **Notas Técnicas:**  
✅ Enfoque de separación UI / lógica crítica  
✅ Evaluaciones limpias y reproducibles  
✅ Banco de preguntas protegidas  
✅ Escalable a nuevos módulos y criterios  

"Evaluar sin exponer. Medir sin sesgar."

## 📬 Contacto Corporativo
**Julián Alberto Ramírez**  
💻 Arquitectura & Evaluación de Sistemas  
⚙️ Automatización | 🧩 Soluciones software | 💡 Innovación tecnológica  
<img width="222" height="29" alt="Image" src="https://github.com/user-attachments/assets/24519130-f605-4762-a4f2-374c450f2b64" />  
🏢 **Soluciones Tecnológicas Avanzadas**  
<img width="150" height="150" alt="Image" src="https://github.com/user-attachments/assets/09c23a95-e483-452e-880f-e7c90c222014" />

📅 **Control de Versiones**  
![Versión](https://img.shields.io/badge/Versión-1.0.0-blue) ![Actualizado](https://img.shields.io/badge/Actualizado-Dic_2025-green)
