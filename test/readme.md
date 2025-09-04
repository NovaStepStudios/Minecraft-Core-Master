## Archivos de Testeo

Si quieres probar **Minecraft-Core-Master**, aquí encontrarás ejemplos rápidos que te ayudarán a comenzar.
Los archivos de testeo están organizados en varias carpetas según su funcionalidad:

### Estructura de Carpetas

```
test/
│   readme.md            # Documentación de testeo
│
├───Advanced             # Tests avanzados
│       Start-AZauth.js      # Test de autenticación Azure
│       Start-Electron.js    # Test de integración con Electron
│       Start-Microsoft.js   # Test de autenticación Microsoft
│
├───components           # Componentes del cliente
│       assets.js           # Manejo de assets
│       client.js           # Funciones del cliente
│       libraries.js        # Manejo de librerías
│       natives.js          # Nativos y dependencias
│       version.js          # Descargar JAR y JSON de version
│
├───Instancie            # Manejo de instancias
│       CreateInstancie.js  # Crear nueva instancia de Minecraft
│       StartInstancie.js   # Iniciar instancia existente
│
├───Login                # Autenticación
│       Microsoft.js       # Login con Microsoft
│       Mojang.js          # Login con Mojang
│       NovaAZauth.js      # Login personalizado NovaAZauth
│
└───Mods                 # Manejo de mods
│       CFModpackExtractor.js # Descargar Modpacks de Curseforge
│       mrpackExtractor.js    # Extrae e instala paquetes `.mrpack`
│
└───Start               # Archivos de Descarga y Ejecucion
        Start.js          # Iniciar Minecraft
        Download.js       # Descargar Minecraft
```

### Consejos rápidos

1. **Leer `readme.md` primero** para entender cómo funciona cada test.
2. Usa `start.js` para probar un inicio básico del cliente.
3. Los scripts dentro de `Advanced` son opcionales y requieren configuraciones adicionales.
