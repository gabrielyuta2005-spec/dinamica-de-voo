# Simulador de Voo 6-DOF — Octacóptero Elétrico (RK4)

![Engenharia Aeronáutica](https://img.shields.io/badge/Curso-Engenharia%20Aeron%C3%A1utica%20IFSP-blue)
![Linguagem](https://img.shields.io/badge/Python-3.10%2B-3776AB?logo=python&logoColor=white)
![Integrador](https://img.shields.io/badge/Integrador-RK4%20(h%20%3D%205%20ms)-success)
![Estados](https://img.shields.io/badge/Modelo%20Din%C3%A2mico-20%20EDOs%20N%C3%A3o%20Lineares-orange)
![Status](https://img.shields.io/badge/Valida%C3%A7%C3%A3o-100%25%20Aprovada-brightgreen)

Simulador de dinâmica de voo não linear com **6 graus de liberdade (6-DOF)** e dinâmica de atuadores (**20 equações diferenciais ordinárias acopladas**) desenvolvido para um **octacóptero elétrico plano de carga ($8{,}00\text{ kg}$)** no âmbito da disciplina de **Dinâmica de Voo** do curso de Bacharelado em Engenharia Aeronáutica do **Instituto Federal de São Paulo (IFSP) — Campus São Carlos**.

O projeto abrange desde a dedução analítica das equações de movimento e integração numérica pelo método de **Runge-Kutta clássico de 4ª ordem (RK4)** até o cálculo de equilíbrios (*trim*), linearização jacobiana, análise modal e simulação em tempo real com controle em cascata e suporte a perturbações atmosféricas.

---

## Sumário

1. [Visão Geral e Recursos Principais](#1-visão-geral-e-recursos-principais)
2. [Especificações Técnicas da Aeronave](#2-especificações-técnicas-da-aeronave)
3. [Formulação Matemática e Arquitetura Numérica](#3-formulação-matemática-e-arquitetura-numérica)
4. [Estrutura do Repositório](#4-estrutura-do-repositório)
5. [Instalação e Execução](#5-instalação-e-execução)
6. [Verificação, Validação e Resultados](#6-verificação-validação-e-resultados)
7. [Modo Interativo 3D e Controle via Gamepad (Opcional)](#7-modo-interativo-3d-e-controle-via-gamepad-opcional)
8. [Equipe e Autoria](#8-equipe-e-autoria)

---

## 1. Visão Geral e Recursos Principais

- **Dinâmica Completa de 20 Estados:** Integração simultânea de posição inercial NED ($3$), atitude via ângulos de Euler 3-2-1 ($3$), velocidades lineares no corpo FRD ($3$), velocidades angulares ($3$) e velocidades de rotação individuais dos $8$ motores ($8$).
- **Aerodinâmica de Rotores de Alta Fidelidade:** Inclui empuxo estático ($k_T \omega_i^2$), perda de empuxo por escoamento axial ($-k_{Tv} \omega_i v_{ax,i}$), arrasto no plano do disco / Força H ($-k_H \omega_i \mathbf{v}_{ip,i}$), torque de reação aerodinâmico ($c_\tau T_i$), efeito giroscópico dos rotores ($\boldsymbol{\omega} \times \mathbf{h}_r$) e torque reativo de aceleração dos motores ($J_r \sum s_i \dot{\omega}_i \mathbf{a}_i$).
- **Integrador RK4 com Retentor de Ordem Zero (ZOH):** Passo fixo $h = 5\text{ ms}$ ($200\text{ Hz}$), garantindo folga de estabilidade numérica ($h|\lambda_{\text{motor}}| = 0{,}10 \ll 2{,}785$) e emulando fielmente um piloto automático digital com saturação em $[\omega_{\min}, \omega_{\max}]$.
- **Suíte Automatizada de Verificação:** Validação contra soluções analíticas exatas (queda livre), leis de conservação (energia cinética e momento angular inercial), ordem de convergência observada ($4{,}004$ frente à referência `DOP853`) e integração paralela por quatérnios.
- **Reprodutibilidade Científica:** Execução única via `python main.py` que executa todos os testes, simula a manobra completa de $62\text{ s}$, gera todas as figuras em alta resolução e exporta automaticamente tabelas e macros para compilação direta em $\LaTeX$.

---

## 2. Especificações Técnicas da Aeronave

A aeronave modelada é um octacóptero simétrico plano ($n = 8$ rotores equidistantes a $45^\circ$, com $\gamma_1 = 22{,}5^\circ$ em relação ao eixo frontal $x_b$ e sentidos de giro alternados $s_i = (-1)^{i-1}$).

| Categoria | Grandeza | Símbolo | Valor | Unidade |
| :--- | :--- | :---: | :---: | :---: |
| **Massa e Inércia** | Massa total da aeronave | $m$ | $8{,}00$ | $\text{kg}$ |
| | Momentos de inércia principais | $I_{xx} = I_{yy}$ | $0{,}505$ | $\text{kg}\cdot\text{m}^2$ |
| | Momento de inércia em guinada | $I_{zz}$ | $0{,}962$ | $\text{kg}\cdot\text{m}^2$ |
| | Inércia axial por conjunto rotativo | $J_r$ | $3{,}0 \times 10^{-4}$ | $\text{kg}\cdot\text{m}^2$ |
| **Geometria** | Distância CG–eixo do rotor | $L$ | $0{,}52$ | $\text{m}$ |
| | Altura do plano dos rotores acima do CG | $h_r$ | $0{,}06$ | $\text{m}$ |
| | Raio da hélice ($15\text{ pol}$) | $R$ | $0{,}19$ | $\text{m}$ |
| | Ângulo inicial / folga entre pontas | $\gamma_1$ / $\delta_p$ | $22{,}5^\circ$ / $18\text{ mm}$ | — |
| **Propulsão** | Coeficiente e constante de empuxo | $C_T$ / $k_T$ | $0{,}0125$ / $6{,}27 \times 10^{-5}$ | — / $\text{N}\cdot\text{s}^2$ |
| | Figura de mérito / coeficiente de torque | $FM$ / $C_Q$ | $0{,}65$ / $1{,}52 \times 10^{-3}$ | — |
| | Razão torque/empuxo | $c_\tau = k_Q/k_T$ | $0{,}0231$ | $\text{m}$ |
| | Perda de empuxo por fluxo axial ($J_0 = 0{,}80$) | $k_{Tv}$ | $1{,}30 \times 10^{-3}$ | $\text{N}\cdot\text{s/m}$ |
| | Coeficiente e constante da Força H | $C_H$ / $k_H$ | $0{,}0025$ / $6{,}60 \times 10^{-5}$ | — / $\text{kg}$ |
| | Constante de tempo dos motores | $\tau_m$ | $0{,}05$ | $\text{s}$ |
| | Limites de rotação e empuxo máximo/rotor | $\omega_{\min}/\omega_{\max}$ / $T_{\max}$ | $60/560\text{ rad/s}$ / $19{,}66\text{ N}$ | — |
| **Aerodinâmica** | Áreas de arrasto parasita da fuselagem | $(C_d A)_{x,y,z}$ | $(0{,}10;\, 0{,}14;\, 0{,}25)$ | $\text{m}^2$ |
| **Referência Hover** | Rotação de equilíbrio em pairado | $\omega_h$ | $395{,}5$ ($3777\text{ rpm}$) | $\text{rad/s}$ |
| | Empuxo por rotor / potência total de eixo | $T_h$ / $P_h$ | $9{,}81\text{ N}$ / $717\text{ W}$ | — |

---

## 3. Formulação Matemática e Arquitetura Numérica

### 3.1 Sistema de Equações Diferenciais ($\mathbf{y} \in \mathbb{R}^{20}$)

O vetor de estado completo é definido por $\mathbf{y} = [\mathbf{p}_I^\top,\, \boldsymbol{\Theta}^\top,\, \mathbf{v}_B^\top,\, \boldsymbol{\omega}^\top,\, \omega_1, \dots, \omega_8]^\top$:

$$\begin{aligned}
\dot{\mathbf{p}}_I &= \mathbf{R}_{IB}(\phi, \theta, \psi)\,\mathbf{v}_B \\
\dot{\boldsymbol{\Theta}} &= \mathbf{W}^{-1}(\phi, \theta)\,\boldsymbol{\omega} \\
\dot{\mathbf{v}}_B &= \frac{1}{m}\left(\mathbf{F}_{\text{prop}} + \mathbf{F}_{\text{fus}}\right) + g\,\mathbf{R}_{IB}^\top \mathbf{e}_z - \boldsymbol{\omega} \times \mathbf{v}_B \\
\dot{\boldsymbol{\omega}} &= \mathbf{I}^{-1}\left[\mathbf{M}_{\text{ext}} - \boldsymbol{\omega} \times (\mathbf{I}\boldsymbol{\omega}) - \boldsymbol{\omega} \times \mathbf{h}_r - J_r \sum_{i=1}^{8} s_i \dot{\omega}_i \mathbf{a}_i\right] \\
\dot{\omega}_i &= \frac{\omega_{c,i} - \omega_i}{\tau_m}, \qquad \omega_{c,i} = \text{clip}(\omega_{\text{cmd},i},\, \omega_{\min},\, \omega_{\max})
\end{aligned}$$

Onde o vetor vento inercial $\mathbf{v}_{\text{vento},I}$ entra diretamente na velocidade relativa ao ar $\mathbf{v}_{ar} = \mathbf{v}_B - \mathbf{R}_{IB}^\top \mathbf{v}_{\text{vento},I}$, afetando tanto o arrasto quadrático da fuselagem quanto as velocidades axiais e no plano de cada cubo de rotor ($\mathbf{v}_i = \mathbf{v}_{ar} + \boldsymbol{\omega} \times \mathbf{r}_i$).

### 3.2 Integrador RK4 e Retentor de Ordem Zero (ZOH)

Em cada passo $t_k \to t_{k+1} = t_k + h$ ($h = 0{,}005\text{ s}$):
1. O controlador avalia $\boldsymbol{\omega}_c = \text{ctrl}(t_k, \mathbf{y}_k)$ e aplica saturação rígida em $[60, 560]\text{ rad/s}$.
2. O comando $\boldsymbol{\omega}_c$ permanece **constante** ao longo dos quatro estágios $k_1, k_2, k_3, k_4$ do método RK4 (ZOH).
3. Após o avanço $\mathbf{y}_{k+1} = \mathbf{y}_k + \frac{h}{6}(k_1 + 2k_2 + 2k_3 + k_4)$, os ângulos $\phi$ e $\psi$ são reduzidos ao intervalo $[-\pi, \pi)$.

### 3.3 Controlador em Cascata (Malha Fechada)

Para ensaiar o veículo (que apresenta oscilação lenta instável em malha aberta com $T = 14{,}44\text{ s}$ e $t_2 = 10{,}55\text{ s}$), o simulador inclui um controlador em cascata de 4 estágios:
1. **Malha Externa de Velocidade (PI):** Gera aceleração desejada $\mathbf{a}_c$ com limitador de taxa de $2{,}0\text{ m/s}^2$ por eixo.
2. **Geração de Empuxo e Atitude Desejada:** Constrói a matriz de rotação alvo $\mathbf{R}_d$ a partir de $\mathbf{f}_d = \mathbf{a}_c - g\mathbf{e}_z$ e $\psi_{\text{ref}}$, com limitação de inclinação a $30^\circ$.
3. **Malha Interna de Atitude (PD + Linearização por Realimentação):** Calcula momentos comandados $\mathbf{M}_c = \mathbf{I}\boldsymbol{\alpha} + \boldsymbol{\omega} \times \mathbf{I}\boldsymbol{\omega}$.
4. **Alocação por Pseudo-Inversa e Dessaturação:** Resolve $\mathbf{T} = \boldsymbol{\Gamma}^+ [T_c,\, \mathbf{M}_c^\top]^\top$, aplica deslocamento coletivo para evitar saturação diferencial e inverte analiticamente $T_i = k_T \omega_i^2 - k_{Tv}\omega_i v_{ax,i}$.

---

## 4. Estrutura do Repositório

```text
octacoptero-simulador-rk4/
├── main.py                  # Orquestrador: testes, manobra (62 s), gráficos e macros LaTeX
├── octa/
│   ├── __init__.py
│   ├── modelo.py            # Classe Octacoptero (parâmetros, geometria, Gamma) e derivs()
│   ├── integrador.py        # rk4_passo(), simular(), ControladorCascata e perfil_manobra()
│   ├── equilibrio.py        # Cálculo de trim por Newton de norma mínima e V_max
│   ├── linearizacao.py      # Jacobianos numéricos (A, B) e modelo analítico de hover
│   ├── modos.py             # Autovalores, fatores de participação e rotulagem modal
│   └── testes.py            # Bateria de verificações numéricas e convergência
├── relatorio/
│   ├── relatorio_final.tex  # Código-fonte LaTeX completo do projeto
│   ├── fig/                 # Figuras geradas automaticamente (validacao, manobra, motor_zoh)
│   ├── tab_testes.tex       # Tabela LaTeX de verificação numérica
│   ├── tab_conv.tex         # Tabela LaTeX de convergência RK4 vs. Euler
│   ├── tab_regime.tex       # Tabela LaTeX de validação cruzada (Simulação vs. Trim)
│   └── macros.tex           # Macros numéricas sincronizadas com o código
└── README.md
```

---

## 5. Instalação e Execução

### Pré-requisitos
- **Python 3.10+**
- Bibliotecas científicas: `numpy`, `scipy`, `matplotlib`
- Distribuição $\LaTeX$ (`texlive` / `pdflatex`) caso deseje compilar o relatório PDF.

### Instalação Rápida

```bash
git clone https://github.com/seu-usuario/octacoptero-simulador-rk4.git
cd octacoptero-simulador-rk4
pip install numpy scipy matplotlib
```

### Executando o Simulador e Gerando Resultados

```bash
# Execução completa (testes numéricos, manobra de 62 s, figuras e tabelas LaTeX)
python main.py

# Execução rápida (varreduras reduzidas)
python main.py --rapido

# Compilação do relatório técnico em PDF
cd relatorio
pdflatex relatorio_final.tex
pdflatex relatorio_final.tex
```

---

## 6. Verificação, Validação e Resultados

### 6.1 Suíte de Verificações Numéricas (`octa/testes.py`)

| Verificação | Valor Obtido | Critério | Status |
| :--- | :---: | :---: | :---: |
| Queda livre ($z_D = \frac{1}{2}gt^2$): erro máximo | $8{,}0 \times 10^{-13}\text{ m}$ | $< 10^{-9}\text{ m}$ | Aprovado |
| Corpo rígido livre ($10\text{ s}$): deriva de $E_c$ e $\mathbf{H}_I$ | $3{,}1 \times 10^{-11}$; $2{,}6 \times 10^{-9}$ | $< 10^{-6}$ | Aprovado |
| Ordem de convergência observada do RK4 (média) | $4{,}004$ | $\ge 3{,}8$ | Aprovado |
| Euler $\times$ Quatérnios: $\max \|\mathbf{R}_E - \mathbf{R}_q\|$ | $3{,}5 \times 10^{-9}$ | $< 10^{-7}$ | Aprovado |
| Matriz de alocação $\boldsymbol{\Gamma}$ $\times$ forças/momentos de `derivs` | $1{,}4 \times 10^{-14}$ | $< 10^{-12}$ | Aprovado |
| Permanência em hover ($5\text{ s}$ em malha aberta): desvio máx. | $2{,}9 \times 10^{-13}$ | $< 10^{-7}$ | Aprovado |
| Estabilidade do passo: $h|\lambda_{\text{motor}}|$ | $0{,}10$ | $< 2{,}785$ | Aprovado |
| Saturação dos comandos em $[\omega_{\min}, \omega_{\max}]$ | Exata | Exata | Aprovado |

### 6.2 Validação Cruzada: Manobra RK4 ($62\text{ s}$) vs. Equilíbrio de Newton

A simulação completa de $62\text{ s}$ ($12\,400$ passos de $5\text{ ms}$) parte de hover a $50\text{ m}$ de altitude e executa subida vertical ($3\text{ m/s}$), voo frontal ($12\text{ m/s}$), voo lateral ($8\text{ m/s}$) e descida ($1{,}5\text{ m/s}$). Os trechos em regime permanente coincidem com os equilíbrios calculados independentemente por Newton:

| Condição de Regime | Atitude Sim. [$^\circ$] | Atitude Trim [$^\circ$] | Rotação Média Sim. [$\text{rad/s}$] | Rotação Trim [$\text{rad/s}$] |
| :--- | :---: | :---: | :---: | :---: |
| Subida vertical ($3{,}0\text{ m/s}$) | — | — | $431{,}7$ | $431{,}2$ |
| Voo frontal ($12{,}0\text{ m/s}$) | $-8{,}32$ | $-8{,}32$ | $420{,}0$ | $419{,}8$ |
| Voo lateral ($8{,}0\text{ m/s}$) | $+5{,}23$ | $+5{,}24$ | $404{,}6$ | $404{,}6$ |
| Descida vertical ($1{,}5\text{ m/s}$) | — | — | $379{,}3$ | $379{,}4$ |

---

## 7. Modo Interativo 3D e Controle via Gamepad (Opcional)

O modelo físico deste repositório também serve de núcleo para a interface interativa 3D em tempo real no navegador (WebGL / Three.js) com suporte nativo à **W3C Gamepad API** para PC:
- **Controles Compatíveis (Bluetooth / USB):** Xbox (One / Series X|S), PlayStation (DualShock 4 / DualSense) e Nintendo Switch (Pro Controller / Joy-Con Grip) com calibração automática e ajuste de curva **Linear $\leftrightarrow$ Exponencial (Expo)**.
- **Pilotagem Mode 2 com Equilíbrio Central:** Com o *stick* esquerdo no neutro (`0.0`), o controlador sustenta o par de equilíbrio ($\omega_h = 395{,}5\text{ rad/s}$); deslocamentos verticais comandam subida/descida, horizontais comandam guinada ($\psi$) e o *stick* direito comanda rolamento ($\phi$) e arfagem ($\theta$).
- **Cenários e Perturbações:** Simulação de vento estacionário $\mathbf{v}_{\text{vento},I}$ e rajadas atmosféricas em pista de testes, cânion urbano e circuito de slalom.

---

## 8. Equipe e Autoria

Trabalho desenvolvido pelos discentes de **Engenharia Aeronáutica — IFSP Campus São Carlos** (Grupo C):

- **Bruno Lanssoni**
- **Gabriel Yuta Nakamichi Sekitani**
- **Gustavo Barbosa dos Santos**
- **José Cristian de Souza Araujo**
- **Matheus dos Anjos Silva**
- **Murilo Ferreira Leonetti**
- **Pedro Henrique dos Santos Estella**

---

## Licença

Este projeto é distribuído para fins acadêmicos e educacionais sob a licença **MIT**.
