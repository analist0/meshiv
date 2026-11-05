import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// חתימה: keystore.properties (לא נשמר ב-Git). בלעדיו — נבנית גרסת debug בלבד.
val keystoreProps = Properties().apply {
    val f = rootProject.file("keystore.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}

// לוח הבקרה וברירות המחדל מגיעים מתיקיית meshiv — מקור אחד לשרת ולאפליקציה
val meshivDir = rootProject.file("../meshiv")
val copyWeb by tasks.registering(Copy::class) {
    from(meshivDir.resolve("public")) { into("www") }
    from(meshivDir.resolve("src/default-config.json"))
    into(layout.buildDirectory.dir("generated/meshiv-assets"))
}

android {
    namespace = "com.elyasharlabs.meshiv"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.elyasharlabs.meshiv"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "1.0.0"
    }

    signingConfigs {
        if (keystoreProps.isNotEmpty()) {
            create("release") {
                storeFile = rootProject.file(keystoreProps.getProperty("storeFile"))
                storePassword = keystoreProps.getProperty("storePassword")
                keyAlias = keystoreProps.getProperty("keyAlias")
                keyPassword = keystoreProps.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.findByName("release")
        }
    }

    sourceSets["main"].assets.srcDir(layout.buildDirectory.dir("generated/meshiv-assets"))

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    testOptions { unitTests.isReturnDefaultValues = true }
}

tasks.named("preBuild") { dependsOn(copyWeb) }

dependencies {
    implementation("androidx.webkit:webkit:1.12.1")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303")
}
