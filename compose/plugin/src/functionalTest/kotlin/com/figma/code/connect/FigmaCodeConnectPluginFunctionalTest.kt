/*
 * This Kotlin source file was generated by the Gradle 'init' task.
 */
package com.figma.code.connect

import org.gradle.internal.impldep.junit.framework.TestCase.assertTrue
import org.gradle.testkit.runner.GradleRunner
import org.junit.jupiter.api.io.TempDir
import java.io.File
import kotlin.test.Test

/**
 * A simple functional test for the 'com.figma.code.connect' plugin.
 */
class FigmaCodeConnectPluginFunctionalTest {
    @field:TempDir
    lateinit var projectDir: File

    private val buildFile by lazy { projectDir.resolve("build.gradle") }
    private val settingsFile by lazy { projectDir.resolve("settings.gradle") }

    private val inputFile by lazy { projectDir.resolve("inputFile.json") }

    private fun testParsing(addImports: Boolean) {
        // Set up the test build
        settingsFile.writeText("")
        buildFile.writeText(
            """
            plugins {
                id('com.figma.code.connect')
            }
            """.trimIndent(),
        )

        // Run the build
        val runner = GradleRunner.create()
        runner.forwardOutput()
        runner.withPluginClasspath()
        runner.withProjectDir(projectDir)

        val srcDir = projectDir.resolve("src/com/figma/code/connect/test").apply { mkdirs() }

        // Copy the Kotlin test file from resources to the src directory
        val kotlinComponent = srcDir.resolve("CodeConnectTestDocument.kt")
        val resourceFile =
            File(javaClass.classLoader.getResource("CodeConnectTestDocument.kt")?.file ?: throw IllegalArgumentException("File not found"))
        resourceFile.copyTo(kotlinComponent)

        val inputJson =
            """
            {
                "mode": "PARSE",
                "paths": [
                "${kotlinComponent.absolutePath}"
                ]
                "autoAddImports" : $addImports
            }
            """.trimIndent()

        inputFile.writeText(inputJson)

        runner.withArguments("parseCodeConnect", "-PfilePath=${inputFile.absolutePath}", "-q")
        val result = runner.build()
        // Verify the result
        assertTrue(
            result.output.removeWhiteSpaces().contains(
                CodeConnectExpectedOutputs.expectedParserResult(filePath = kotlinComponent.absolutePath, addImports).removeWhiteSpaces(),
            ),
        )
    }

    @Test fun testParsingWithImports() {
        testParsing(true)
    }

    @Test fun testParsingWithoutImports() {
        testParsing(false)
    }

    @Test fun testCreateScript() {
        // Set up the test build
        settingsFile.writeText("")
        buildFile.writeText(
            """
            plugins {
                id('com.figma.code.connect')
            }
            """.trimIndent(),
        )

        // Run the build
        val runner = GradleRunner.create()
        runner.forwardOutput()
        runner.withPluginClasspath()
        runner.withProjectDir(projectDir)

        val inputJson =
            """
            {
              "mode": "CREATE",
              "destinationDir": "${projectDir.absolutePath}",
              "component": {
                "figmaNodeUrl": "https://www.figma.com/file/e0pacvsdruHTI949l24Oxofe/FCC-Test-Component?node-id=1-39",
                "id": "1:39",
                "name": "Test Instance Component",
                "normalizedName": "TestInstanceComponent",
                "type": "COMPONENT_SET",
                "componentPropertyDefinitions": {
                  "Color": {
                    "type": "VARIANT",
                    "defaultValue": "Default",
                    "variantOptions": [
                      "Default",
                      "Red"
                    ]
                  },
                  "name": {
                    "type": "TEXT",
                    "defaultValue": "Click me!",
                  },
                   "isDisabled": {
                    "type": "BOOLEAN",
                    "defaultValue": false,
                  },
                   "icon": {
                  "type" : "INSTANCE_SWAP",
                    "defaultValue": "IconComponent"
                },  
                }
              }
            }
            """.trimIndent()

        inputFile.writeText(inputJson)

        runner.withArguments("createCodeConnect", "-PfilePath=${inputFile.absolutePath}")
        runner.build()

        val expected =
            File(javaClass.classLoader.getResource("CodeConnectTemplateTest.kt")?.file ?: throw IllegalArgumentException("File not found"))

        assertTrue(
            projectDir.resolve(
                "TestInstanceComponent.figma.kt",
            ).readText().removeWhiteSpaces().contains(expected.readText().removeWhiteSpaces()),
        )
    }

    fun String.removeWhiteSpaces(): String {
        return this.replace("\\s+".toRegex(), "")
    }
}
