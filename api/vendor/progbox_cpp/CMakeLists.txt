cmake_minimum_required(VERSION 3.14)
project(progbox VERSION 1.0.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

find_package(Threads REQUIRED)
include_directories(${CMAKE_SOURCE_DIR}/include)
include_directories(${CMAKE_SOURCE_DIR}/scripts)

# =============================================================================
# Progression Registry Generation
# =============================================================================

find_package(Python3 REQUIRED COMPONENTS Interpreter)

set(PROGRESSION_SCRIPTS_DIR "${CMAKE_SOURCE_DIR}/scripts")
set(GENERATED_REGISTRY_DIR "${CMAKE_SOURCE_DIR}/include")
set(GENERATED_REGISTRY_HEADER "${GENERATED_REGISTRY_DIR}/generated_progression_registry.hpp")
set(GENERATOR_SCRIPT "${CMAKE_SOURCE_DIR}/cmake/generate_progression_registry.py")

# Verify script exists before trying to run it
if(NOT EXISTS "${GENERATOR_SCRIPT}")
    message(FATAL_ERROR "Generator script not found at: ${GENERATOR_SCRIPT}\nMake sure you moved the python script to a 'cmake/' folder.")
endif()

# Verify scan directory exists
if(NOT EXISTS "${PROGRESSION_SCRIPTS_DIR}")
    message(FATAL_ERROR "Scripts directory not found at: ${PROGRESSION_SCRIPTS_DIR}")
endif()

# Configure-time generation
# NOTE: We use ${Python3_EXECUTABLE} here instead of Python3::Interpreter
# because execute_process sometimes fails to resolve imported targets.
execute_process(
    COMMAND "${Python3_EXECUTABLE}" "${GENERATOR_SCRIPT}"
        --scan-dir "${PROGRESSION_SCRIPTS_DIR}"
        --output "${GENERATED_REGISTRY_HEADER}"
        --source-dir "${CMAKE_SOURCE_DIR}"
    WORKING_DIRECTORY "${CMAKE_SOURCE_DIR}"
    RESULT_VARIABLE registry_gen_result
    OUTPUT_VARIABLE registry_gen_output
    ERROR_VARIABLE registry_gen_error
    OUTPUT_STRIP_TRAILING_WHITESPACE
    ERROR_STRIP_TRAILING_WHITESPACE
)

# Always print output for debugging
if(registry_gen_output)
    message(STATUS "Generator stdout:\n${registry_gen_output}")
endif()
if(registry_gen_error)
    message(STATUS "Generator stderr:\n${registry_gen_error}")
endif()

if(NOT registry_gen_result EQUAL "0")
    message(FATAL_ERROR 
        "Failed to generate progression registry\n"
        "  Return code: ${registry_gen_result}\n"
        "  Stdout: ${registry_gen_output}\n"
        "  Stderr: ${registry_gen_error}"
    )
endif()

add_executable(progbox src/main.cpp)
target_link_libraries(progbox PRIVATE Threads::Threads)

if(CMAKE_BUILD_TYPE STREQUAL "Release")
    target_compile_options(progbox PRIVATE -O3 -march=native -flto)
endif()