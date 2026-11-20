plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "moe.wuwaviewer"
    compileSdk = 35
    defaultConfig {
        applicationId = "moe.wuwaviewer"
        minSdk = 26
        targetSdk = 35
        versionCode = 4
        versionName = "1.3"
    }
    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("debug")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    sourceSets["main"].assets.srcDirs("src/main/assets", "build/generated/webassets")
    androidResources { noCompress += listOf("png", "js", "json", "css", "html") }
}

// Copy the web viewer (../../web) into the APK assets under web/
val copyWeb by tasks.registering(Sync::class) {
    from(rootProject.file("../web")) { exclude("models/**") }
    into(layout.buildDirectory.dir("generated/webassets/web"))
}
tasks.named("preBuild") { dependsOn(copyWeb) }

dependencies {
    implementation("androidx.webkit:webkit:1.12.1")
    implementation("androidx.activity:activity-ktx:1.9.3")
}
