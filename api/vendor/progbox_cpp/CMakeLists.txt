cmake_minimum_required(VERSION 3.14)
project(progbox VERSION 1.0.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

find_package(Threads REQUIRED)
include_directories(${CMAKE_SOURCE_DIR}/include)

add_executable(progbox src/main.cpp)
target_link_libraries(progbox PRIVATE Threads::Threads)

if(CMAKE_BUILD_TYPE STREQUAL "Release")
    target_compile_options(progbox PRIVATE -O3 -march=native -flto)
endif()