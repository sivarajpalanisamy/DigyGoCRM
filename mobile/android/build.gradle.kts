allprojects {
    repositories {
        google()
        mavenCentral()
    }
}

// Build OUTSIDE OneDrive - OneDrive sync locks files under the synced folder and
// breaks `mergeReleaseNativeLibs` with AccessDeniedException. This keeps all build
// intermediates on local-only disk.
val newBuildDir: Directory =
    rootProject.layout.buildDirectory
        .dir("C:/digygo_build")
        .get()
rootProject.layout.buildDirectory.value(newBuildDir)

subprojects {
    val newSubprojectBuildDir: Directory = newBuildDir.dir(project.name)
    project.layout.buildDirectory.value(newSubprojectBuildDir)
}
subprojects {
    project.evaluationDependsOn(":app")
}

tasks.register<Delete>("clean") {
    delete(rootProject.layout.buildDirectory)
}
